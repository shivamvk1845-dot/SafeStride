import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { config } from "./config.js";
import { clearSessionCookie, requireAuth, setSessionCookie } from "./auth.js";
import { prisma } from "./db.js";

export const app = express();

app.disable("x-powered-by");
if (config.production) app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: config.origin, credentials: true }));
app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin && origin !== config.origin) {
    res.status(403).json({ error: "Origin not allowed." });
    return;
  }
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

const wrap = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
const requiredId = (req: Request): string => {
  if (!req.userId) throw Object.assign(new Error("Authentication required."), { status: 401 });
  return req.userId;
};
const event = (journeyId: string, type: string, details?: string, simulated = false) =>
  prisma.journeyEvent.create({ data: { journeyId, type, details, simulated } });
const activeStatuses = ["RUNNING", "CHECKIN_DUE", "GRACE_PERIOD", "ESCALATED", "SOS"] as const;
const isActive = (status: string) => (activeStatuses as readonly string[]).includes(status);

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "safestride-api" }));

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
}).strict();
app.post("/api/auth/register", wrap(async (req, res) => {
  const body = registerSchema.parse(req.body);
  const email = body.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }
  const user = await prisma.user.create({
    data: { name: body.name, email, passwordHash: await bcrypt.hash(body.password, 12) },
    select: { id: true, name: true, email: true },
  });
  setSessionCookie(res, user.id);
  res.status(201).json({ user });
}));

app.post("/api/auth/login", wrap(async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).strict().parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  setSessionCookie(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
}));

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});
app.get("/api/auth/me", requireAuth, wrap(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: requiredId(req) },
    select: { id: true, name: true, email: true, timezone: true, locationConsent: true },
  });
  if (!user) { res.status(401).json({ error: "Account not found." }); return; }
  res.json({ user });
}));

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/share/")) { next(); return; }
  requireAuth(req, res, next);
});

app.patch("/api/users/me", wrap(async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().max(80).optional(),
    locationConsent: z.boolean().optional(),
  }).strict().parse(req.body);
  const user = await prisma.user.update({
    where: { id: requiredId(req) },
    data: body,
    select: { id: true, name: true, email: true, timezone: true, locationConsent: true },
  });
  res.json({ user });
}));

app.delete("/api/users/me", wrap(async (req, res) => {
  await prisma.user.delete({ where: { id: requiredId(req) } });
  clearSessionCookie(res);
  res.status(204).end();
}));

app.get("/api/contacts", wrap(async (req, res) => {
  res.json({ contacts: await prisma.trustedContact.findMany({ where: { ownerId: requiredId(req) }, orderBy: { createdAt: "desc" } }) });
}));
app.post("/api/contacts", wrap(async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(80),
    email: z.string().email().max(254),
    phone: z.string().max(30).optional(),
  }).strict().parse(req.body);
  const contact = await prisma.trustedContact.create({
    data: { ...body, email: body.email.toLowerCase(), ownerId: requiredId(req) },
  });
  res.status(201).json({ contact });
}));
app.delete("/api/contacts/:id", wrap(async (req, res) => {
  const id = z.string().min(1).parse(req.params.id);
  const result = await prisma.trustedContact.deleteMany({ where: { id, ownerId: requiredId(req) } });
  if (!result.count) { res.status(404).json({ error: "Trusted contact not found." }); return; }
  res.status(204).end();
}));

const journeyInput = z.object({
  origin: z.string().trim().min(1).max(160),
  destination: z.string().trim().min(1).max(160),
  mode: z.enum(["cab/auto", "walking", "bus/metro"]),
  vehicleDetails: z.string().trim().max(120).optional(),
  expectedArrival: z.string().datetime(),
  checkInMinutes: z.number().int().min(1).max(120),
  graceMinutes: z.number().int().min(1).max(60),
  contactIds: z.array(z.string()).max(10).default([]),
  locationSharing: z.boolean(),
  demo: z.boolean().default(false),
});

app.post("/api/journeys", wrap(async (req, res) => {
  const userId = requiredId(req);
  const body = journeyInput.parse(req.body);
  const expectedArrival = new Date(body.expectedArrival);
  if (expectedArrival <= new Date()) {
    res.status(400).json({ error: "Expected arrival must be in the future." });
    return;
  }
  const existing = await prisma.journey.findFirst({ where: { userId, status: { in: [...activeStatuses] } } });
  if (existing) {
    res.status(409).json({ error: "Finish or cancel your active journey before starting another." });
    return;
  }
  if (body.contactIds.length) {
    const authorized = await prisma.trustedContact.count({ where: { id: { in: body.contactIds }, ownerId: userId } });
    if (authorized !== new Set(body.contactIds).size) {
      res.status(400).json({ error: "Select only your saved trusted contacts." });
      return;
    }
  }
  const now = new Date();
  const nextCheckInAt = new Date(Math.min(now.getTime() + body.checkInMinutes * 60000, expectedArrival.getTime()));
  const journey = await prisma.journey.create({
    data: {
      userId, origin: body.origin, destination: body.destination, mode: body.mode,
      vehicleDetails: body.vehicleDetails, expectedArrival, checkInMinutes: body.checkInMinutes,
      graceMinutes: body.graceMinutes, nextCheckInAt, locationSharing: body.locationSharing,
      demo: body.demo,
      events: { create: { type: "JOURNEY_STARTED", details: body.demo ? "Demo journey started." : "Journey started." , simulated: body.demo } },
      scheduledTasks: { create: { kind: "CHECKIN_DUE", runAt: nextCheckInAt } },
      trustedContacts: { create: body.contactIds.map((trustedContactId) => ({ trustedContactId })) },
    },
  });
  res.status(201).json({ journey });
}));

async function getOwnedJourney(req: Request, res: Response) {
  const id = z.string().min(1).parse(req.params.id);
  const journey = await prisma.journey.findFirst({
    where: { id, userId: requiredId(req) },
    include: { locations: { orderBy: { recordedAt: "desc" }, take: 1 }, checkIns: { orderBy: { createdAt: "desc" } }, events: { orderBy: { createdAt: "desc" }, take: 30 }, notifications: { orderBy: { createdAt: "desc" } }, trustedContacts: { include: { trustedContact: { select: { id: true, name: true, email: true } } } } },
  });
  if (!journey) { res.status(404).json({ error: "Journey not found." }); return undefined; }
  return journey;
}
app.get("/api/journeys", wrap(async (req, res) => {
  const journeys = await prisma.journey.findMany({
    where: { userId: requiredId(req) }, orderBy: { startedAt: "desc" },
    include: { locations: { orderBy: { recordedAt: "desc" }, take: 1 }, checkIns: true, events: true, notifications: true, trustedContacts: { include: { trustedContact: { select: { id: true, name: true, email: true } } } } },
  });
  res.json({ journeys });
}));
app.get("/api/journeys/active", wrap(async (req, res) => {
  const journey = await prisma.journey.findFirst({
    where: { userId: requiredId(req), status: { in: [...activeStatuses] } },
    orderBy: { startedAt: "desc" },
    include: { locations: { orderBy: { recordedAt: "desc" }, take: 1 }, checkIns: { orderBy: { createdAt: "desc" } }, events: { orderBy: { createdAt: "desc" } }, notifications: true, trustedContacts: { include: { trustedContact: { select: { id: true, name: true, email: true } } } } },
  });
  res.json({ journey });
}));
app.get("/api/journeys/:id", wrap(async (req, res) => {
  const journey = await getOwnedJourney(req, res);
  if (journey) res.json({ journey });
}));

async function cancelScheduled(journeyId: string) {
  await prisma.scheduledTask.updateMany({ where: { journeyId, processedAt: null }, data: { processedAt: new Date() } });
}
async function recordNotifications(journeyId: string, contacts: { email: string }[], kind: string) {
  for (const contact of contacts) {
    await prisma.notification.upsert({
      where: { journeyId_recipient_kind: { journeyId, recipient: contact.email, kind } },
      create: { journeyId, recipient: contact.email, kind, provider: config.notificationProvider, status: config.notificationProvider === "simulated" ? "SIMULATED" : "PENDING" },
      update: {},
    });
  }
}

app.post("/api/journeys/:id/check-in", wrap(async (req, res) => {
  const journey = await getOwnedJourney(req, res);
  if (!journey) return;
  if (!isActive(journey.status)) { res.status(409).json({ error: "This journey is no longer active." }); return; }
  const body = z.object({ message: z.string().max(240).optional() }).strict().parse(req.body);
  const nextCheckInAt = new Date(Math.min(Date.now() + journey.checkInMinutes * 60000, journey.expectedArrival.getTime()));
  const updated = await prisma.$transaction(async (tx) => {
    await tx.scheduledTask.updateMany({ where: { journeyId: journey.id, processedAt: null }, data: { processedAt: new Date() } });
    const result = await tx.journey.update({ where: { id: journey.id }, data: { status: "RUNNING", nextCheckInAt } });
    await tx.checkIn.create({ data: { journeyId: journey.id, kind: "SAFE", message: body.message } });
    await tx.journeyEvent.create({ data: { journeyId: journey.id, type: "CHECK_IN", details: body.message ?? "Traveler confirmed they are safe.", simulated: journey.demo } });
    await tx.scheduledTask.create({ data: { journeyId: journey.id, kind: "CHECKIN_DUE", runAt: nextCheckInAt } });
    return result;
  });
  res.json({ journey: updated });
}));

app.post("/api/journeys/:id/delay", wrap(async (req, res) => {
  const journey = await getOwnedJourney(req, res);
  if (!journey) return;
  if (!isActive(journey.status)) { res.status(409).json({ error: "This journey is no longer active." }); return; }
  const body = z.object({ delayMinutes: z.number().int().min(1).max(360), message: z.string().max(240).optional() }).strict().parse(req.body);
  const nextCheckInAt = new Date(Math.min(Date.now() + journey.checkInMinutes * 60000, journey.expectedArrival.getTime() + body.delayMinutes * 60000));
  const updated = await prisma.$transaction(async (tx) => {
    await tx.scheduledTask.updateMany({ where: { journeyId: journey.id, processedAt: null }, data: { processedAt: new Date() } });
    const result = await tx.journey.update({ where: { id: journey.id }, data: { status: "RUNNING", expectedArrival: new Date(journey.expectedArrival.getTime() + body.delayMinutes * 60000), nextCheckInAt } });
    await tx.checkIn.create({ data: { journeyId: journey.id, kind: "DELAY", message: body.message ?? `Running ${body.delayMinutes} minutes late.` } });
    await tx.journeyEvent.create({ data: { journeyId: journey.id, type: "DELAY_REPORTED", details: body.message ?? `ETA extended by ${body.delayMinutes} minutes.`, simulated: journey.demo } });
    await tx.scheduledTask.create({ data: { journeyId: journey.id, kind: "CHECKIN_DUE", runAt: nextCheckInAt } });
    return result;
  });
  res.json({ journey: updated });
}));

app.post("/api/journeys/:id/arrive", wrap(async (req, res) => {
  const journey = await getOwnedJourney(req, res);
  if (!journey) return;
  if (!isActive(journey.status)) { res.status(409).json({ error: "This journey is no longer active." }); return; }
  const updated = await prisma.journey.update({ where: { id: journey.id }, data: { status: "COMPLETED", endedAt: new Date() } });
  await cancelScheduled(journey.id);
  await event(journey.id, "ARRIVED_SAFELY", "Journey completed.", journey.demo);
  res.json({ journey: updated });
}));
app.post("/api/journeys/:id/cancel", wrap(async (req, res) => {
  const journey = await getOwnedJourney(req, res);
  if (!journey) return;
  if (!isActive(journey.status)) { res.status(409).json({ error: "This journey is no longer active." }); return; }
  const updated = await prisma.journey.update({ where: { id: journey.id }, data: { status: "CANCELLED", endedAt: new Date() } });
  await cancelScheduled(journey.id);
  await prisma.shareToken.updateMany({ where: { journeyId: journey.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await event(journey.id, "JOURNEY_CANCELLED", "Journey cancelled.", journey.demo);
  res.json({ journey: updated });
}));

app.post("/api/journeys/:id/sos", wrap(async (req, res) => {
  const journey = await getOwnedJourney(req, res);
  if (!journey) return;
  if (!isActive(journey.status)) { res.status(409).json({ error: "This journey is no longer active." }); return; }
  const contacts = (await prisma.journeyTrustedContact.findMany({
    where: { journeyId: journey.id }, include: { trustedContact: true },
  })).map(({ trustedContact }) => trustedContact);
  const updated = await prisma.journey.update({ where: { id: journey.id }, data: { status: "SOS" } });
  await cancelScheduled(journey.id);
  await event(journey.id, "SOS_TRIGGERED", journey.demo ? "Demo SOS simulated; no emergency services contacted." : "SOS requested by traveler.", journey.demo);
  if (!journey.demo) await recordNotifications(journey.id, contacts, "SOS");
  res.json({
    journey: updated,
    notifications: journey.demo
      ? "SIMULATED; no contacts or emergency services were contacted."
      : "Notification attempts were recorded as SIMULATED; no SMS or emergency services were contacted. Call local emergency services directly if needed.",
  });
}));

app.post("/api/journeys/:id/location", wrap(async (req, res) => {
  const journey = await getOwnedJourney(req, res);
  if (!journey) return;
  if (!journey.locationSharing) { res.status(403).json({ error: "Location sharing was not enabled for this journey." }); return; }
  if (!isActive(journey.status)) { res.status(409).json({ error: "This journey is no longer active." }); return; }
  const body = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict().parse(req.body);
  const location = await prisma.journeyLocation.create({ data: { journeyId: journey.id, ...body } });
  res.status(201).json({ location });
}));

app.post("/api/journeys/:id/share", wrap(async (req, res) => {
  const journey = await getOwnedJourney(req, res);
  if (!journey) return;
  if (!isActive(journey.status)) { res.status(409).json({ error: "Only active journeys can be shared." }); return; }
  const token = randomBytes(32).toString("base64url");
  await prisma.shareToken.create({
    data: { journeyId: journey.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) },
  });
  res.status(201).json({ shareUrl: `${config.origin}/share/${token}`, expiresInHours: 4 });
}));
app.delete("/api/journeys/:id/share", wrap(async (req, res) => {
  const journey = await getOwnedJourney(req, res);
  if (!journey) return;
  await prisma.shareToken.updateMany({ where: { journeyId: journey.id, revokedAt: null }, data: { revokedAt: new Date() } });
  res.status(204).end();
}));

app.get("/api/guardian/:id", wrap(async (req, res) => {
  const id = z.string().min(1).parse(req.params.id);
  const user = await prisma.user.findUnique({ where: { id: requiredId(req) }, select: { email: true } });
  const journey = await prisma.journey.findUnique({
    where: { id },
    include: { user: { select: { id: true } }, locations: { orderBy: { recordedAt: "desc" }, take: 1 }, checkIns: { orderBy: { createdAt: "desc" } }, events: { orderBy: { createdAt: "desc" }, take: 30 }, notifications: true },
  });
  if (!user || !journey) { res.status(404).json({ error: "Journey not found." }); return; }
  const permitted = await prisma.journeyTrustedContact.findFirst({
    where: { journeyId: journey.id, trustedContact: { email: user.email } },
  });
  if (!permitted) { res.status(403).json({ error: "You are not an authorized trusted contact for this journey." }); return; }
  res.json({ journey: { id: journey.id, origin: journey.origin, destination: journey.destination, mode: journey.mode, expectedArrival: journey.expectedArrival, status: journey.status, nextCheckInAt: journey.nextCheckInAt, locations: journey.locations, checkIns: journey.checkIns, events: journey.events, notifications: journey.notifications } });
}));

app.get("/api/share/:token", wrap(async (req, res) => {
  const token = z.string().min(1).parse(req.params.token);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const share = await prisma.shareToken.findUnique({ where: { tokenHash }, include: { journey: { include: { locations: { orderBy: { recordedAt: "desc" }, take: 1 }, events: { orderBy: { createdAt: "desc" }, take: 10 } } } } });
  if (!share || share.revokedAt || share.expiresAt <= new Date()) { res.status(404).json({ error: "This share link is invalid or expired." }); return; }
  res.json({ journey: { id: share.journey.id, origin: share.journey.origin, destination: share.journey.destination, status: share.journey.status, expectedArrival: share.journey.expectedArrival, locations: share.journey.locationSharing ? share.journey.locations : [], events: share.journey.events.map(({ type, createdAt }) => ({ type, createdAt })) } });
}));

app.post("/api/demo/:id/:action", wrap(async (req, res) => {
  const journey = await getOwnedJourney(req, res);
  if (!journey) return;
  if (!journey.demo) { res.status(403).json({ error: "Simulation actions are available only for demo journeys." }); return; }
  const action = req.params.action;
  const now = new Date();
  let status = journey.status;
  if (action === "due") status = "GRACE_PERIOD";
  else if (action === "escalate") status = "ESCALATED";
  else if (action === "sos") status = "SOS";
  else if (action === "arrive") status = "COMPLETED";
  else { res.status(400).json({ error: "Unknown demo action." }); return; }
  await prisma.journey.update({ where: { id: journey.id }, data: { status, ...(status === "COMPLETED" ? { endedAt: now } : {}) } });
  await event(journey.id, `DEMO_${action.toUpperCase()}`, `Simulated demo action: ${action}.`, true);
  if (status === "COMPLETED") await cancelScheduled(journey.id);
  if (status === "ESCALATED") await recordNotifications(journey.id, await prisma.trustedContact.findMany({ where: { ownerId: journey.userId } }), "DEMO_ESCALATION");
  if (status === "SOS") await event(journey.id, "SOS_SIMULATED", "No emergency services were contacted.", true);
  res.json({ journey: await prisma.journey.findUnique({ where: { id: journey.id } }) });
}));

app.post("/api/demo/reset", wrap(async (req, res) => {
  const userId = requiredId(req);
  const journey = await prisma.journey.findFirst({ where: { userId, demo: true, status: { in: [...activeStatuses] } } });
  if (journey) {
    await prisma.scheduledTask.deleteMany({ where: { journeyId: journey.id } });
    await prisma.journey.delete({ where: { id: journey.id } });
  }
  res.status(204).end();
}));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "Please check the submitted fields.", details: err.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) });
    return;
  }
  const status = typeof err === "object" && err !== null && "status" in err ? Number((err as { status: unknown }).status) : 500;
  if (status >= 500) console.error("API request failed:", err instanceof Error ? err.name : "UnknownError");
  res.status(status || 500).json({ error: status >= 500 ? "An unexpected server error occurred." : (err instanceof Error ? err.message : "Request failed.") });
});
