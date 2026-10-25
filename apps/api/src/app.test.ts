import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./app.js";
import { config, resolveWebOrigin } from "./config.js";
import { sessionCookieOptions } from "./auth.js";
import { prisma } from "./db.js";
import { processDueTasks } from "./worker.js";

describe("SafeStride API", () => {
  let cookie = "";
  let journeyId = "";
  const email = `test-${Date.now()}@example.test`;

  beforeAll(async () => {
    const response = await request(app).post("/api/auth/register").send({
      name: "Test Traveler", email, password: "correct-horse-battery-staple",
    });
    expect(response.status).toBe(201);
    cookie = response.headers["set-cookie"][0].split(";")[0];
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("uses the production frontend origin when WEB_ORIGIN is blank", () => {
    expect(resolveWebOrigin("", true)).toBe("https://safestride-web.onrender.com");
    expect(resolveWebOrigin("   ", true)).toBe("https://safestride-web.onrender.com");
  });

  it("registers, restores, logs in, and logs out an authenticated session", async () => {
    expect(sessionCookieOptions(true)).toMatchObject({ sameSite: "none", secure: true, httpOnly: true, path: "/" });
    expect(sessionCookieOptions(false)).toMatchObject({ sameSite: "strict", secure: false, httpOnly: true, path: "/" });
    expect((await request(app).get("/api/journeys")).status).toBe(401);

    const restored = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(restored.status).toBe(200);
    expect(restored.body.user.email).toBe(email);

    const login = await request(app).post("/api/auth/login").send({
      email, password: "correct-horse-battery-staple",
    });
    expect(login.status).toBe(200);
    const loginCookie = login.headers["set-cookie"][0].split(";")[0];
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(login.headers["set-cookie"][0]).toContain("SameSite=Strict");
    expect((await request(app).get("/api/auth/me").set("Cookie", loginCookie)).status).toBe(200);

    const logout = await request(app).post("/api/auth/logout").set("Cookie", loginCookie);
    expect(logout.status).toBe(204);
    expect(logout.headers["set-cookie"][0]).toContain("Expires=Thu, 01 Jan 1970");
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/journeys").set("Cookie", cookie)).status).toBe(200);
  });

  it("allows credentialed CORS preflight only from the configured web origin", async () => {
    const allowed = await request(app)
      .options("/api/auth/login")
      .set("Origin", config.origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");

    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(config.origin);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(allowed.headers["access-control-allow-methods"]).toContain("POST");
    expect(allowed.headers["access-control-allow-headers"]).toContain("content-type");

    const rejected = await request(app)
      .options("/api/auth/login")
      .set("Origin", `${config.origin}.attacker.invalid`)
      .set("Access-Control-Request-Method", "POST");

    expect(rejected.status).toBe(204);
    expect(rejected.headers["access-control-allow-origin"]).toBe(config.origin);
    expect(rejected.headers["access-control-allow-origin"]).not.toBe(`${config.origin}.attacker.invalid`);
  });

  it("rejects credentialed requests from a different browser origin", async () => {
    const rejected = await request(app)
      .post("/api/auth/logout")
      .set("Origin", "https://attacker.example")
      .set("Cookie", cookie);

    expect(rejected.status).toBe(403);
    expect(rejected.body.error).toBe("Origin not allowed.");
  });

  it("requires authentication for private journeys", async () => {
    expect((await request(app).get("/api/journeys")).status).toBe(401);
  });

  it("creates, checks into, and completes a persisted journey", async () => {
    const created = await request(app).post("/api/journeys").set("Cookie", cookie).send({
      origin: "Example origin", destination: "Example destination", mode: "walking",
      expectedArrival: new Date(Date.now() + 90 * 60000).toISOString(),
      checkInMinutes: 20, graceMinutes: 5, contactIds: [], locationSharing: false, demo: true,
    });
    expect(created.status).toBe(201);
    journeyId = created.body.journey.id;
    expect(created.body.journey.status).toBe("RUNNING");

    const checkedIn = await request(app).post(`/api/journeys/${journeyId}/check-in`).set("Cookie", cookie).send({});
    expect(checkedIn.status).toBe(200);
    const arrived = await request(app).post(`/api/journeys/${journeyId}/arrive`).set("Cookie", cookie).send({});
    expect(arrived.body.journey.status).toBe("COMPLETED");
    const fetched = await request(app).get(`/api/journeys/${journeyId}`).set("Cookie", cookie);
    expect(fetched.body.journey.checkIns).toHaveLength(1);
  });

  it("records SOS without sending notifications or contacting emergency services", async () => {
    const contactEmail = `guardian-${Date.now()}@example.test`;
    const contact = await request(app).post("/api/contacts").set("Cookie", cookie).send({
      name: "Test Guardian", email: contactEmail,
    });
    expect(contact.status).toBe(201);
    const created = await request(app).post("/api/journeys").set("Cookie", cookie).send({
      origin: "Test origin", destination: "Test destination", mode: "walking",
      expectedArrival: new Date(Date.now() + 90 * 60000).toISOString(),
      checkInMinutes: 20, graceMinutes: 5, contactIds: [contact.body.contact.id],
      locationSharing: false, demo: false,
    });
    expect(created.status).toBe(201);

    const id = created.body.journey.id as string;
    const sos = await request(app).post(`/api/journeys/${id}/sos`).set("Cookie", cookie).send({});
    expect(sos.status).toBe(200);
    expect(sos.body.journey.status).toBe("SOS");
    expect(sos.body.notifications).toContain("SIMULATED");
    expect(sos.body.notifications).toContain("no SMS or emergency services were contacted");

    const fetched = await request(app).get(`/api/journeys/${id}`).set("Cookie", cookie);
    expect(fetched.body.journey.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "SOS_TRIGGERED" }),
    ]));
    expect(fetched.body.journey.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipient: contactEmail, kind: "SOS", provider: "simulated", status: "SIMULATED" }),
    ]));
    await prisma.journey.update({ where: { id }, data: { status: "COMPLETED", endedAt: new Date() } });
    await prisma.scheduledTask.updateMany({ where: { journeyId: id }, data: { processedAt: new Date() } });
  });

  it("runs persisted deadlines once and escalates after the grace period", async () => {
    const created = await request(app).post("/api/journeys").set("Cookie", cookie).send({
      origin: "Demo start", destination: "Demo end", mode: "walking",
      expectedArrival: new Date(Date.now() + 90 * 60000).toISOString(),
      checkInMinutes: 20, graceMinutes: 5, contactIds: [], locationSharing: false, demo: true,
    });
    expect(created.status).toBe(201);
    const id = created.body.journey.id as string;
    const now = new Date();
    await prisma.scheduledTask.updateMany({ where: { journeyId: id, kind: "CHECKIN_DUE" }, data: { runAt: new Date(now.getTime() - 1000) } });
    await processDueTasks(now);
    expect((await prisma.journey.findUniqueOrThrow({ where: { id } })).status).toBe("CHECKIN_DUE");
    await processDueTasks(now);
    expect((await prisma.journey.findUniqueOrThrow({ where: { id } })).status).toBe("GRACE_PERIOD");

    await prisma.scheduledTask.updateMany({ where: { journeyId: id, kind: "GRACE_EXPIRED" }, data: { runAt: new Date(now.getTime() - 1000) } });
    await processDueTasks(now);
    await processDueTasks(now);
    expect((await prisma.journey.findUniqueOrThrow({ where: { id } })).status).toBe("ESCALATED");
    expect(await prisma.journeyEvent.count({ where: { journeyId: id, type: "ESCALATED" } })).toBe(1);
    await prisma.journey.update({ where: { id }, data: { status: "COMPLETED", endedAt: now } });
  });

  it("keeps private journey APIs protected and revokes public share links", async () => {
    const created = await request(app).post("/api/journeys").set("Cookie", cookie).send({
      origin: "Share start", destination: "Share destination", mode: "bus/metro",
      expectedArrival: new Date(Date.now() + 60 * 60000).toISOString(),
      checkInMinutes: 15, graceMinutes: 5, contactIds: [], locationSharing: false, demo: true,
    });
    expect(created.status).toBe(201);
    const id = created.body.journey.id as string;
    expect((await request(app).get(`/api/guardian/${id}`).set("Cookie", cookie)).status).toBe(403);

    const share = await request(app).post(`/api/journeys/${id}/share`).set("Cookie", cookie).send({});
    expect(share.status).toBe(201);
    const token = new URL(share.body.shareUrl).pathname.split("/").at(-1);
    expect((await request(app).get(`/api/share/${token}`)).status).toBe(200);
    await request(app).delete(`/api/journeys/${id}/share`).set("Cookie", cookie);
    expect((await request(app).get(`/api/share/${token}`)).status).toBe(404);
  });
});
