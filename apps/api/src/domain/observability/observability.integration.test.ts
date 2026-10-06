import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Log everything during this file so request lines can be inspected (set before the logger module loads).
vi.hoisted(() => {
  process.env.LOG_LEVEL = "debug";
});
vi.mock("../../providers/email/resend", () => ({ sendMail: async () => undefined }));

import request from "supertest";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Job } from "bullmq";
import type { Request, Response } from "express";
import { app } from "../../app";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { hashToken } from "../../lib/token-hash";
import { signAccessToken } from "../../lib/jwt";
import { signCustomerAccessToken } from "../../lib/customer-jwt";
import { CUSTOMER_ACCESS_COOKIE } from "../../lib/cookies";
import { AppError } from "../../lib/app-error";
import { queueConnection } from "../../lib/queue";
import { currentCorrelationId, runWithContext } from "../../lib/observability/context";
import { logger, setLogSink } from "../../lib/observability/logger";
import { registerErrorReporter, type CapturedError } from "../../lib/observability/error-capture";
import { observeJob, jobContextId } from "../../lib/observability/jobs";
import { errorHandler } from "../../middlewares/error-handler";
import { processOutboxEvent } from "../outbox/processor";
import { readinessReport, READINESS_CHECK_TIMEOUT_MS } from "../../modules/ops/readiness";
import { cleanupFixtures, createStockedProduct, checkout, trackOrder, RUN, ownerId } from "../../test-fixtures";

// Phase 11 (contract §6): correlation IDs end to end, redacted structured logs, provider-neutral error capture, readiness,
// attention signals. Observability never writes business state.

const lines: string[] = [];
const captured: CapturedError[] = [];
let unregister: () => void;
const madeAdmins: string[] = [];
const madeCustomers: string[] = [];

beforeAll(() => {
  setLogSink((line) => lines.push(line));
  unregister = registerErrorReporter((c) => captured.push(c));
});

afterAll(async () => {
  setLogSink(null);
  unregister();
  await cleanupFixtures();
  await prisma.outboxEvent.deleteMany({ where: { consumer: "p11-test" } });
  if (madeAdmins.length) await prisma.adminUser.deleteMany({ where: { id: { in: madeAdmins } } });
  if (madeCustomers.length) await prisma.customer.deleteMany({ where: { id: { in: madeCustomers } } });
  await prisma.$disconnect();
});

describe("correlation IDs", () => {
  it("every response carries one: generated when absent, preserved when valid, replaced when unsafe", async () => {
    const generated = (await request(app).get("/health")).headers["x-correlation-id"];
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);

    const preserved = (await request(app).get("/health").set("X-Correlation-Id", "client-trace-12345")).headers["x-correlation-id"];
    expect(preserved).toBe("client-trace-12345");

    for (const bad of ["short", "has spaces in it", "x".repeat(65), "01712345678@evil.com", "<script>alert(1)</script>"]) {
      const res = await request(app).get("/health").set("X-Correlation-Id", bad);
      expect(res.headers["x-correlation-id"]).not.toBe(bad);
      expect(res.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("propagates request → outbox rows → consumer execution", async () => {
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const res = await request(app)
      .post("/api/orders")
      .set("X-Correlation-Id", `p11-corr-${RUN}`)
      .send(checkout([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: "01799910077" }));
    expect(res.status).toBe(201);
    trackOrder(res.body.order.id);
    const rows = await prisma.outboxEvent.findMany({ where: { aggregateId: res.body.order.id } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.correlationId === `p11-corr-${RUN}`)).toBe(true);

    // The worker runs the consumer inside the recording request's context.
    const row = await prisma.outboxEvent.create({
      data: { eventType: "test.v1", consumer: "p11-test", eventKey: `k-${RUN}`, aggregateType: "test", aggregateId: "t", payload: {}, correlationId: `p11-worker-${RUN}` },
    });
    let seen: string | null = null;
    const outcome = await processOutboxEvent(row.id, {
      consumers: { "p11-test": { name: "p11-test", eventTypes: ["test.v1"], payload: z.object({}).passthrough(), idempotency: "test", handle: async () => ((seen = currentCorrelationId()), "ok") } as never },
    });
    expect(outcome.outcome).toBe("processed");
    expect(seen).toBe(`p11-worker-${RUN}`);
  });

  it("jobs inherit a carried correlation ID or get their own", async () => {
    expect(jobContextId({ data: { correlationId: "campaign-req-1234" } })).toBe("campaign-req-1234");
    expect(jobContextId({ data: {} })).toMatch(/^[0-9a-f-]{36}$/);
    let inside: string | null = null;
    await observeJob("p11-queue", async () => void (inside = currentCorrelationId()))({ name: "tick", data: { correlationId: "job-trace-5678" } } as unknown as Job);
    expect(inside).toBe("job-trace-5678");
  });
});

describe("structured logs never carry secrets", () => {
  it("credential-like keys are redacted; phones, emails, JWTs and long tokens are masked", () => {
    lines.length = 0;
    const jwt = signAccessToken({ adminId: "a", role: "OWNER" });
    runWithContext({ correlationId: "redaction-test-1", operation: "test" }, () =>
      logger._force("info", `incoming ${jwt}`, {
        password: "Hunter2Secret!",
        otp: "246810",
        code: "135790",
        refreshToken: "a".repeat(80),
        authorization: "Bearer xyz",
        apiKey: "sk_live_123",
        note: "call 01712345678 or write jane.doe@example.com",
        nested: { secretKey: "s3cr3t", token: "tok" },
      }),
    );
    const out = lines.join("\n");
    for (const leaked of ["Hunter2Secret!", "246810", "135790", "a".repeat(80), "Bearer xyz", "sk_live_123", "01712345678", "jane.doe@example.com", "s3cr3t", jwt]) {
      expect(out).not.toContain(leaked);
    }
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ level: "info", correlationId: "redaction-test-1", operation: "test" });
    expect(typeof entry.ts).toBe("string");
  });

  it("request logging never includes bodies — a login and an OTP verification leave no password or code in the logs", async () => {
    lines.length = 0;
    const phone = "01799910088";
    await prisma.phoneOtp.create({ data: { phone, codeHash: hashToken("864213"), expiresAt: new Date(Date.now() + 60_000) } });
    await request(app).post("/api/customers/login").send({ email: `nobody-${RUN}@example.com`, password: "SuperSecretPw9!" });
    await request(app).post("/api/customers/otp/verify").send({ phone, code: "864213" });
    const out = lines.join("\n");
    expect(out).toContain('"msg":"request"');
    for (const leaked of ["SuperSecretPw9!", "864213", phone]) expect(out).not.toContain(leaked);
    await prisma.phoneOtp.deleteMany({ where: { phone } });
  });
});

describe("error capture", () => {
  const fakeRes = () => {
    const res = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json() { return this; } };
    return res as unknown as Response & { statusCode: number };
  };
  const fakeReq = { method: "GET", baseUrl: "/api/x", path: "/y" } as Request;

  it("captures unexpected (5xx) errors from handlers, never 4xx outcomes", () => {
    captured.length = 0;
    errorHandler(new AppError(404, "nope"), fakeReq, fakeRes(), () => undefined);
    expect(captured).toHaveLength(0);
    const res = fakeRes();
    runWithContext({ correlationId: "handler-corr-1", operation: "GET /api/x/y" }, () => errorHandler(new Error("boom"), fakeReq, res, () => undefined));
    expect(res.statusCode).toBe(500);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ correlationId: "handler-corr-1", errorClass: "unexpected" });
  });

  it("captures worker and outbox-consumer failures (and re-throws so retry handling is unchanged)", async () => {
    captured.length = 0;
    await expect(observeJob("p11-queue", async () => { throw new Error("job failed"); })({ name: "tick", data: {} } as unknown as Job)).rejects.toThrow("job failed");
    expect(captured.at(-1)?.context).toMatchObject({ queue: "p11-queue", job: "tick" });

    const row = await prisma.outboxEvent.create({
      data: { eventType: "test.v1", consumer: "p11-test", eventKey: `k2-${RUN}`, aggregateType: "test", aggregateId: "t", payload: {}, correlationId: `p11-fail-${RUN}` },
    });
    const outcome = await processOutboxEvent(row.id, {
      consumers: { "p11-test": { name: "p11-test", eventTypes: ["test.v1"], payload: z.object({}).passthrough(), idempotency: "test", handle: async () => { throw new Error("provider down"); } } as never },
    });
    expect(outcome.outcome).toBe("retry");
    expect(captured.at(-1)).toMatchObject({ correlationId: `p11-fail-${RUN}` });
    expect(captured.at(-1)?.context).toMatchObject({ outboxEventId: row.id });
  });
});

describe("readiness (liveness stays /health)", () => {
  const ok = () => Promise.resolve(true);
  it("ready only when PostgreSQL, Redis and the dispatcher are all healthy", async () => {
    expect(await readinessReport({ postgres: ok, redis: ok, outboxDispatcher: ok })).toEqual({ ready: true, checks: { postgres: true, redis: true, outboxDispatcher: true } });
    expect(await readinessReport({ postgres: () => Promise.reject(new Error("db down")), redis: ok, outboxDispatcher: ok })).toMatchObject({ ready: false, checks: { postgres: false } });
    expect(await readinessReport({ postgres: ok, redis: () => Promise.reject(new Error("ECONNREFUSED")), outboxDispatcher: ok })).toMatchObject({ ready: false, checks: { redis: false } });
    expect(await readinessReport({ postgres: ok, redis: ok, outboxDispatcher: () => Promise.resolve(false) })).toMatchObject({ ready: false, checks: { outboxDispatcher: false } });
  });

  it("a hung dependency counts as not ready within the check timeout", async () => {
    const started = Date.now();
    const report = await readinessReport({ postgres: () => new Promise(() => undefined), redis: ok, outboxDispatcher: ok });
    expect(report.checks.postgres).toBe(false);
    expect(Date.now() - started).toBeLessThan(READINESS_CHECK_TIMEOUT_MS + 1_000);
  });

  it("the real endpoint reports the actual dependencies (and 503 when not ready); /health stays liveness", async () => {
    // The queue connection queues commands while Redis is down — bound the probe like readiness does.
    const redisUp = await Promise.race([queueConnection.ping().then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), READINESS_CHECK_TIMEOUT_MS))]);
    const res = await request(app).get("/health/ready");
    expect(res.body.checks.postgres).toBe(true);
    expect(res.body.checks.redis).toBe(redisUp);
    expect(res.status).toBe(res.body.ready ? 200 : 503);
    expect(Object.keys(res.body)).toEqual(["ready", "checks"]);
    const live = await request(app).get("/health");
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: "ok" });
  });
});

describe("attention signals", () => {
  it("counts/status only, for an admin with ops.read or the monitor token — nobody else", async () => {
    const staff = await prisma.adminUser.create({ data: { name: "P11 ops", email: `p11-ops-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role: "STAFF" } });
    madeAdmins.push(staff.id);
    const customer = await prisma.customer.create({ data: { name: "P11 cust", phone: "01799910099" } });
    madeCustomers.push(customer.id);

    expect((await request(app).get("/api/v1/ops/attention")).status).toBe(401);
    expect((await request(app).get("/api/v1/ops/attention").set("Cookie", [`${CUSTOMER_ACCESS_COOKIE}=${signCustomerAccessToken({ customerId: customer.id })}`])).status).toBe(401);
    const asStaff = await request(app).get("/api/v1/ops/attention").set("Cookie", [`access_token=${signAccessToken({ adminId: staff.id, role: "STAFF" })}`]);
    expect(asStaff.status).toBe(200);
    expect(asStaff.body.signals).toEqual(
      expect.objectContaining({ outboxFailed: expect.any(Number), stuckCampaigns: expect.any(Number), courierOutcomeUnknown: expect.any(Number), paymentLedgerDrift: expect.any(Number), stockDrift: expect.any(Number), loyaltyDrift: expect.any(Number), dispatcherUnhealthy: expect.any(Number) }),
    );
    for (const v of Object.values(asStaff.body.signals)) expect(typeof v).toBe("number");
    expect(Object.keys(asStaff.body).sort()).toEqual(["generatedAt", "needsAttention", "signals"]);
    expect(JSON.stringify(asStaff.body)).not.toMatch(/@|01\d{9}|ORD-/); // no emails, phones or order numbers

    const saved = env.opsMonitorToken;
    try {
      (env as { opsMonitorToken: string }).opsMonitorToken = "";
      expect((await request(app).get("/api/v1/ops/attention").set("Authorization", "Bearer anything")).status).toBe(401); // disabled when unset
      (env as { opsMonitorToken: string }).opsMonitorToken = `monitor-${RUN}`;
      expect((await request(app).get("/api/v1/ops/attention").set("Authorization", `Bearer monitor-${RUN}`)).status).toBe(200);
      expect((await request(app).get("/api/v1/ops/attention").set("Authorization", "Bearer wrong-token")).status).toBe(401);
    } finally {
      (env as { opsMonitorToken: string }).opsMonitorToken = saved;
    }
    void ownerId;
  });
});
