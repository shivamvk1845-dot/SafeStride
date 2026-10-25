import { prisma } from "./db.js";

let processing = false;

export async function processDueTasks(now = new Date()): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const tasks = await prisma.scheduledTask.findMany({
      where: { processedAt: null, runAt: { lte: now } },
      orderBy: { runAt: "asc" },
      take: 50,
      include: { journey: { include: { user: true, trustedContacts: { include: { trustedContact: true } } } } },
    });
    for (const task of tasks) {
      await prisma.$transaction(async (tx) => {
        const marked = await tx.scheduledTask.updateMany({
          where: { id: task.id, processedAt: null },
          data: { processedAt: now },
        });
        if (!marked.count) return;
        const journey = await tx.journey.findUnique({
          where: { id: task.journeyId },
          include: { user: true, trustedContacts: { include: { trustedContact: true } } },
        });
        if (!journey) return;
        if (task.kind === "CHECKIN_DUE" && journey.status === "RUNNING") {
          await tx.journey.update({ where: { id: journey.id }, data: { status: "CHECKIN_DUE" } });
          await tx.journeyEvent.create({ data: { journeyId: journey.id, type: "CHECKIN_DUE", details: "Check-in is due. The grace period begins.", simulated: journey.demo } });
          await tx.scheduledTask.create({ data: { journeyId: journey.id, kind: "GRACE_START", runAt: now } });
          await tx.notification.create({
            data: { journeyId: journey.id, recipient: journey.user.email, kind: `CHECKIN_REMINDER_${task.id}`, provider: journey.demo ? "simulated" : "in-app", status: journey.demo ? "SIMULATED" : "IN_APP" },
          });
        } else if (task.kind === "GRACE_START" && journey.status === "CHECKIN_DUE") {
          const graceEnds = new Date(now.getTime() + journey.graceMinutes * 60000);
          await tx.journey.update({ where: { id: journey.id }, data: { status: "GRACE_PERIOD", nextCheckInAt: graceEnds } });
          await tx.journeyEvent.create({ data: { journeyId: journey.id, type: "GRACE_PERIOD_STARTED", details: `You have ${journey.graceMinutes} minutes to check in.`, simulated: journey.demo } });
          await tx.scheduledTask.create({ data: { journeyId: journey.id, kind: "GRACE_EXPIRED", runAt: graceEnds } });
        } else if (task.kind === "GRACE_EXPIRED" && journey.status === "GRACE_PERIOD") {
          await tx.journey.update({ where: { id: journey.id }, data: { status: "ESCALATED" } });
          await tx.journeyEvent.create({ data: { journeyId: journey.id, type: "ESCALATED", details: journey.demo ? "Demo escalation; no real contacts notified." : "Grace period elapsed; trusted contacts notified.", simulated: journey.demo } });
          if (!journey.demo) {
            for (const relation of journey.trustedContacts) {
              const contact = relation.trustedContact;
              await tx.notification.upsert({
                where: { journeyId_recipient_kind: { journeyId: journey.id, recipient: contact.email, kind: "MISSED_CHECKIN_ESCALATION" } },
                create: { journeyId: journey.id, recipient: contact.email, kind: "MISSED_CHECKIN_ESCALATION", provider: process.env.NOTIFICATION_PROVIDER ?? "simulated", status: "SIMULATED" },
                update: {},
              });
            }
          }
        }
      });
    }
  } finally {
    processing = false;
  }
}
