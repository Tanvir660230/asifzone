import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { Queue, Worker } from "bullmq";
import { z } from "zod";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { queueConnection } from "../../lib/queue";
import { RUN, asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { applyOrderTransition, updateOrderStatus } from "../../modules/orders/order.service";
import { settlePaymentSession } from "../../modules/payments/payment.service";
import { awardDeliveryPoints } from "../../modules/customers/customer.service";
import { updateSettings } from "../../modules/settings/settings.service";
import { SmsProviderError } from "../../lib/sms";
import { MailProviderError } from "../../lib/mailer";
import { MetaApiError } from "../../lib/meta/capi";
import { recordOutboxEvents } from "./outbox";
import { OUTBOX_CONSUMERS, type OutboxConsumer } from "./consumers";
import {
  DISPATCH_LEASE_MS,
  OUTBOX_MAX_ATTEMPTS,
  PROCESS_LEASE_MS,
  dispatchOutbox,
  isRetryable,
  outboxJobId,
  processOutboxEvent,
  reapStaleClaims,
  retryDelayMs,
  retryOutboxEvent,
} from "./processor";

// Phase 8 (docs/PHASE_8_AUDIT.md): durable intent committed with business truth; at-least-once delivery; idempotent
// consumers; outbox failures never touch business truth.

let admin: string;
const madeIds: string[] = [];
const aggregateIds: string[] = [];
let seq = 0;

/** A stand-alone intent row (aggregate "Test") for dispatcher/worker tests. */
async function testEvent(over: { consumer?: string; eventType?: string; payload?: Record<string, unknown>; attempts?: number } = {}) {
  const aggregateId = `p8-${RUN}-${++seq}`;
  aggregateIds.push(aggregateId);
  const row = await prisma.outboxEvent.create({
    data: {
      eventType: over.eventType ?? "test.happened.v1",
      consumer: over.consumer ?? "test-consumer",
      eventKey: aggregateId,
      aggregateType: "Test",
      aggregateId,
      payload: (over.payload ?? { n: seq }) as object,
      attempts: over.attempts ?? 0,
    },
  });
  madeIds.push(row.id);
  return row;
}

/** An injectable consumer that records every call. */
function recorder(behaviour: (call: number) => Promise<"sent"> = async () => "sent") {
  const calls: unknown[] = [];
  const consumer: OutboxConsumer<{ n?: number }> = {
    eventTypes: ["test.happened.v1"],
    payload: z.object({ n: z.number().optional() }).passthrough(),
    idempotency: "test",
    async handle(p) {
      calls.push(p);
      return behaviour(calls.length);
    },
    scrub: () => ({ scrubbed: true }),
  };
  return { calls, consumers: { "test-consumer": consumer } as Record<string, OutboxConsumer> };
}

const rowOf = (id: string) => prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
const intentsFor = (orderId: string) => prisma.outboxEvent.findMany({ where: { aggregateId: orderId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  admin = await ownerId();
});

afterAll(async () => {
  const orders = await prisma.order.findMany({ where: { orderNumber: { contains: "" }, items: { some: { productNameSnapshot: { contains: RUN } } } }, select: { id: true } });
  await prisma.outboxEvent.deleteMany({ where: { OR: [{ id: { in: madeIds } }, { aggregateId: { in: [...aggregateIds, ...orders.map((o) => o.id)] } }] } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function order() {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
  const o = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  aggregateIds.push(o.id);
  return o;
}

describe("transaction atomicity", () => {
  it("a committed order carries its side-effect intents (customer + admin SMS), pending", async () => {
    const o = await order();
    const rows = await intentsFor(o.id);
    expect(rows.map((r) => [r.consumer, r.eventType, r.status, r.eventKey]).sort()).toEqual([
      ["admin-order-alert-sms", "order.placed.v1", "PENDING", `order:${o.id}:placed`],
      ["customer-order-sms", "order.placed.v1", "PENDING", `order:${o.id}:placed`],
    ]);
    expect(rows.find((r) => r.consumer === "customer-order-sms")!.payload).toEqual({ orderId: o.id, touchpoint: "PLACED" });
  });

  it("a rolled-back transaction leaves no intent", async () => {
    const aggregateId = `p8-rollback-${RUN}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await recordOutboxEvents(tx, [{ eventType: "order.placed.v1", consumer: "admin-order-alert-sms", eventKey: aggregateId, aggregateType: "Order", aggregateId, payload: { orderId: aggregateId } }]);
        throw new Error("business rule failed");
      }),
    ).rejects.toThrow("business rule failed");
    expect(await prisma.outboxEvent.count({ where: { aggregateId } })).toBe(0);
  });

  it("an intent that can't be recorded rolls the business change back (truth can't commit without its intent)", async () => {
    const o = await order();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: o.id }, data: { adminNotes: "must not persist" } });
        await recordOutboxEvents(tx, [{ eventType: "order.placed.v1", consumer: "customer-order-sms", eventKey: `x:${o.id}`, aggregateType: "Order", aggregateId: o.id, payload: { orderId: o.id, touchpoint: "BOGUS" } }]);
      }),
    ).rejects.toThrow(/invalid order.placed.v1 payload/);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).adminNotes).not.toBe("must not persist");
    await expect(
      prisma.$transaction((tx) => recordOutboxEvents(tx, [{ eventType: "order.placed.v9", consumer: "customer-order-sms", eventKey: "v9", aggregateType: "Order", aggregateId: o.id, payload: { orderId: o.id, touchpoint: "PLACED" } }])),
    ).rejects.toThrow(/doesn't accept order.placed.v9/);
  });

  it("a status transition commits its SMS intent (keyed by the history row); a rolled-back transition leaves neither", async () => {
    const o = await order();
    await updateOrderStatus(o.id, { status: "CONFIRMED" }, admin);
    const history = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: o.id, status: "CONFIRMED" } });
    const sms = (await intentsFor(o.id)).find((r) => r.eventType === "order.status_changed.v1")!;
    expect([sms.consumer, sms.eventKey, sms.payload]).toEqual(["customer-order-sms", `status:${history.id}`, { orderId: o.id, touchpoint: "CONFIRMED" }]);

    const before = await prisma.outboxEvent.count({ where: { aggregateId: o.id } });
    await expect(
      prisma.$transaction(async (tx) => {
        await applyOrderTransition(tx, o.id, { status: "SHIPPED" }, { adminId: admin });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CONFIRMED");
    expect(await prisma.outboxEvent.count({ where: { aggregateId: o.id } })).toBe(before);
  });

  it("a gateway settlement commits the CONFIRMED SMS and the receipt email intents with the ledger row", async () => {
    const o = await order();
    await prisma.order.update({ where: { id: o.id }, data: { paymentMethod: "EPS_PG" } });
    const session = await prisma.paymentSession.create({ data: { orderId: o.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: `p8_${o.id}`, expiresAt: new Date(Date.now() + 60_000) } });
    await settlePaymentSession(session.gatewayTransactionRef, `eps_${o.id}`, Number(o.total));
    const rows = await intentsFor(o.id);
    expect(rows.some((r) => r.consumer === "payment-receipt-email" && r.eventType === "payment.settled.v1" && r.eventKey === `order:${o.id}:paid`)).toBe(true);
    expect(rows.some((r) => r.consumer === "customer-order-sms" && (r.payload as { touchpoint: string }).touchpoint === "CONFIRMED")).toBe(true);
    expect(await prisma.payment.count({ where: { orderId: o.id, status: "SUCCEEDED" } })).toBe(1);
  });

  it("the same intent recorded twice is stored once (unique consumer + eventKey)", async () => {
    const aggregateId = `p8-dup-${RUN}`;
    aggregateIds.push(aggregateId);
    const intent = { eventType: "order.placed.v1", consumer: "admin-order-alert-sms" as const, eventKey: aggregateId, aggregateType: "Order", aggregateId, payload: { orderId: aggregateId } };
    await prisma.$transaction((tx) => recordOutboxEvents(tx, [intent]));
    await prisma.$transaction((tx) => recordOutboxEvents(tx, [intent]));
    expect(await prisma.outboxEvent.count({ where: { aggregateId } })).toBe(1);
  });
});

describe("loyalty points are written in the business transaction (not a side effect)", () => {
  it("delivery awards points atomically; a rolled-back delivery awards none; concurrent awards never double-count", async () => {
    const original = (await prisma.storeSetting.findUniqueOrThrow({ where: { id: "singleton" } })).rewardPointsPerCurrency;
    try {
      await updateSettings({ rewardPointsPerCurrency: 0.1 });
      const rolledBack = await order();
      await expect(
        prisma.$transaction(async (tx) => {
          await applyOrderTransition(tx, rolledBack.id, { status: "DELIVERED" }, { adminId: admin });
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      expect(await prisma.rewardPointsEntry.count({ where: { orderId: rolledBack.id } })).toBe(0);

      const delivered = await order();
      await updateOrderStatus(delivered.id, { status: "DELIVERED" }, admin);
      expect(await prisma.rewardPointsEntry.count({ where: { orderId: delivered.id, reason: "order_delivered" } })).toBe(1);

      const racer = await order();
      await Promise.all([1, 2, 3, 4].map(() => prisma.$transaction((tx) => awardDeliveryPoints(tx, racer.customerId!, racer.id, 1000))));
      expect(await prisma.rewardPointsEntry.count({ where: { orderId: racer.id, reason: "order_delivered" } })).toBe(1);
    } finally {
      await updateSettings({ rewardPointsPerCurrency: Number(original) });
    }
  });
});

describe("dispatcher", () => {
  it("one event: enqueued once with its per-attempt job id, then ENQUEUED", async () => {
    const e = await testEvent();
    const jobs: string[] = [];
    const r = await dispatchOutbox({ onlyIds: [e.id], enqueue: async ({ jobId }) => void jobs.push(jobId) });
    expect([r, jobs]).toEqual([{ claimed: 1, enqueued: 1, deferred: 0 }, [outboxJobId(e.id, 0)]]);
    expect((await rowOf(e.id)).status).toBe("ENQUEUED");
  });

  it("concurrent dispatchers never enqueue the same event twice (10 rounds × 4 dispatchers × 25 events)", async () => {
    const counts: number[] = [];
    for (let round = 0; round < 10; round++) {
      const events = await Promise.all(Array.from({ length: 25 }, () => testEvent()));
      const ids = events.map((e) => e.id);
      const jobs: string[] = [];
      const enqueue = async ({ jobId }: { jobId: string }) => {
        await new Promise((r) => setTimeout(r, Math.random() * 5));
        jobs.push(jobId);
      };
      await Promise.all([1, 2, 3, 4].map(() => dispatchOutbox({ onlyIds: ids, enqueue })));
      expect(new Set(jobs).size).toBe(jobs.length);
      expect(jobs.length).toBe(25);
      counts.push(jobs.length);
    }
    expect(counts).toEqual(Array(10).fill(25));
  });

  it("Redis unavailable: the enqueue fails, the row stays PENDING (claim released, retried later) — nothing is lost", async () => {
    const e = await testEvent();
    const now = new Date();
    const r = await dispatchOutbox({ onlyIds: [e.id], now, enqueue: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:6379"); } });
    const row = await rowOf(e.id);
    expect(r).toEqual({ claimed: 1, enqueued: 0, deferred: 1 });
    expect([row.status, row.claimedUntil, row.lastError?.startsWith("enqueue failed")]).toEqual(["PENDING", null, true]);
    expect(row.availableAt.getTime()).toBeGreaterThan(now.getTime());
    const later = await dispatchOutbox({ onlyIds: [e.id], now: new Date(row.availableAt.getTime() + 1), enqueue: async () => undefined });
    expect(later.enqueued).toBe(1);
  });

  it("crash after claim, before enqueue: the lease blocks others until it expires, then the event is dispatched", async () => {
    const e = await testEvent();
    const now = new Date();
    await prisma.outboxEvent.update({ where: { id: e.id }, data: { claimedUntil: new Date(now.getTime() + DISPATCH_LEASE_MS) } }); // a crashed dispatcher's claim
    expect((await dispatchOutbox({ onlyIds: [e.id], now, enqueue: async () => undefined })).claimed).toBe(0);
    expect((await dispatchOutbox({ onlyIds: [e.id], now: new Date(now.getTime() + DISPATCH_LEASE_MS + 1), enqueue: async () => undefined })).enqueued).toBe(1);
  });

  it("crash after enqueue, before marking ENQUEUED: the redispatch reuses the same job id (deduplicated), one delivery", async () => {
    const e = await testEvent();
    const queue = new Set<string>(); // stands in for BullMQ's jobId deduplication
    const enqueue = async ({ jobId }: { jobId: string }) => void queue.add(jobId);
    const now = new Date();
    queue.add(outboxJobId(e.id, 0)); // the first dispatcher enqueued …
    await prisma.outboxEvent.update({ where: { id: e.id }, data: { claimedUntil: new Date(now.getTime() - 1) } }); // … then crashed; lease expired
    await dispatchOutbox({ onlyIds: [e.id], now, enqueue });
    expect([...queue]).toEqual([outboxJobId(e.id, 0)]);
    const { calls, consumers } = recorder();
    await processOutboxEvent(e.id, { consumers });
    await processOutboxEvent(e.id, { consumers }); // the duplicate job, if BullMQ had kept both
    expect(calls).toHaveLength(1);
  });
});

describe("worker", () => {
  it("success: processed once, payload scrubbed, duplicate delivery is a no-op", async () => {
    const e = await testEvent();
    const { calls, consumers } = recorder();
    expect(await processOutboxEvent(e.id, { consumers })).toEqual({ outcome: "processed", result: "sent" });
    expect(await processOutboxEvent(e.id, { consumers })).toEqual({ outcome: "skipped" });
    const row = await rowOf(e.id);
    expect([calls.length, row.status, row.attempts, row.payload]).toEqual([1, "PROCESSED", 1, { scrubbed: true }]);
  });

  it("concurrent duplicate deliveries run the side effect exactly once (10 rounds × 5 workers)", async () => {
    const counts: number[] = [];
    for (let round = 0; round < 10; round++) {
      const e = await testEvent();
      const { calls, consumers } = recorder(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "sent";
      });
      await Promise.all([1, 2, 3, 4, 5].map(() => processOutboxEvent(e.id, { consumers })));
      counts.push(calls.length);
    }
    expect(counts).toEqual(Array(10).fill(1));
  });

  it("retryable failure → back to PENDING with exponential backoff; not redelivered early; succeeds later", async () => {
    const e = await testEvent();
    const now = new Date();
    const { calls, consumers } = recorder(async (n) => {
      if (n === 1) throw new SmsProviderError("HTTP 503", true);
      return "sent";
    });
    const first = await processOutboxEvent(e.id, { consumers, now });
    expect(first).toMatchObject({ outcome: "retry", attempts: 1 });
    const row = await rowOf(e.id);
    expect([row.status, row.availableAt.getTime() - now.getTime(), row.lastError]).toEqual(["PENDING", retryDelayMs(1), "HTTP 503"]);
    expect(await processOutboxEvent(e.id, { consumers, now: new Date(now.getTime() + 5_000) })).toEqual({ outcome: "skipped" });
    expect(await processOutboxEvent(e.id, { consumers, now: new Date(now.getTime() + retryDelayMs(1) + 1) })).toMatchObject({ outcome: "processed" });
    expect(calls).toHaveLength(2);
    expect([retryDelayMs(1), retryDelayMs(2), retryDelayMs(3)]).toEqual([30_000, 60_000, 120_000]);
  });

  it("non-retryable failure → FAILED at once; max attempts → FAILED; an operator retry sends it round again", async () => {
    const permanent = await testEvent();
    const r1 = recorder(async () => {
      throw new MailProviderError("422 invalid recipient", false);
    });
    expect(await processOutboxEvent(permanent.id, { consumers: r1.consumers })).toMatchObject({ outcome: "failed", attempts: 1 });
    expect((await rowOf(permanent.id)).status).toBe("FAILED");

    const exhausted = await testEvent({ attempts: OUTBOX_MAX_ATTEMPTS - 1 });
    const r2 = recorder(async () => {
      throw new Error("timeout");
    });
    expect(await processOutboxEvent(exhausted.id, { consumers: r2.consumers })).toMatchObject({ outcome: "failed", attempts: OUTBOX_MAX_ATTEMPTS });
    expect((await rowOf(exhausted.id)).lastError).toMatch(/gave up after 8 attempts/);

    expect(await retryOutboxEvent(exhausted.id)).toBe(true);
    expect(await rowOf(exhausted.id)).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(await retryOutboxEvent(exhausted.id)).toBe(false); // only FAILED rows
  });

  it("an unsupported consumer or event version is refused, not retried", async () => {
    const wrongVersion = await testEvent({ eventType: "test.happened.v2" });
    const { calls, consumers } = recorder();
    expect(await processOutboxEvent(wrongVersion.id, { consumers })).toMatchObject({ outcome: "failed" });
    expect((await rowOf(wrongVersion.id)).lastError).toMatch(/doesn't accept event test.happened.v2/);
    const unknown = await testEvent({ consumer: "nobody" });
    expect(await processOutboxEvent(unknown.id, { consumers })).toMatchObject({ outcome: "failed" });
    expect(calls).toHaveLength(0);
  });

  it("worker crash mid-delivery: the lease expires, the reaper returns it, it is delivered again (at-least-once)", async () => {
    const e = await testEvent();
    const now = new Date();
    await prisma.outboxEvent.update({ where: { id: e.id }, data: { status: "PROCESSING", attempts: 1, claimedUntil: new Date(now.getTime() + PROCESS_LEASE_MS) } });
    const { calls, consumers } = recorder();
    expect(await processOutboxEvent(e.id, { consumers, now })).toEqual({ outcome: "skipped" }); // still leased
    expect((await reapStaleClaims(now)).processing).toBeGreaterThanOrEqual(0);
    expect((await rowOf(e.id)).status).toBe("PROCESSING");
    await reapStaleClaims(new Date(now.getTime() + PROCESS_LEASE_MS + 1));
    expect(await rowOf(e.id)).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(await processOutboxEvent(e.id, { consumers, now: new Date(now.getTime() + PROCESS_LEASE_MS + 2) })).toMatchObject({ outcome: "processed" });
    expect([calls.length, (await rowOf(e.id)).attempts]).toEqual([1, 2]);
  });

  it("failure classification follows the providers' own signals", () => {
    expect([isRetryable(new SmsProviderError("503", true)), isRetryable(new SmsProviderError("rejected", false))]).toEqual([true, false]);
    expect([isRetryable(new MailProviderError("429", true)), isRetryable(new MailProviderError("422", false))]).toEqual([true, false]);
    expect([isRetryable(new MetaApiError("5xx", true)), isRetryable(new MetaApiError("bad token", false))]).toEqual([true, false]);
    expect([isRetryable(new Error("ECONNRESET")), isRetryable(Object.assign(new Error("x"), { name: "UnrecoverableError" }))]).toEqual([true, false]);
  });
});

describe("real consumers and business truth", () => {
  it("customer SMS, admin alert and receipt email deliver against the real order; a duplicate delivery sends nothing more", async () => {
    const o = await order();
    for (const row of await intentsFor(o.id)) {
      const out = await processOutboxEvent(row.id);
      expect(out.outcome).toBe("processed");
      expect(await processOutboxEvent(row.id)).toEqual({ outcome: "skipped" });
    }
    expect((await intentsFor(o.id)).every((r) => r.status === "PROCESSED")).toBe(true);
  });

  it("a failing side effect changes no business truth: order, stock, ledger and points stay exactly as committed", async () => {
    const o = await order();
    await updateOrderStatus(o.id, { status: "DELIVERED" }, admin);
    const snapshot = async () =>
      JSON.stringify({
        order: await prisma.order.findUniqueOrThrow({ where: { id: o.id }, select: { status: true, total: true, paymentStatus: true } }),
        stock: await prisma.stockMovement.findMany({ where: { orderId: o.id }, select: { change: true, reason: true }, orderBy: { createdAt: "asc" } }),
        payments: await prisma.payment.findMany({ where: { orderId: o.id }, select: { amount: true, status: true } }),
        points: await prisma.rewardPointsEntry.findMany({ where: { orderId: o.id }, select: { points: true, reason: true } }),
      });
    const before = await snapshot();
    const failing = { "customer-order-sms": { ...OUTBOX_CONSUMERS["customer-order-sms"], handle: async () => { throw new SmsProviderError("rejected", false); } } } as Record<string, OutboxConsumer>;
    for (const row of await intentsFor(o.id)) if (row.consumer === "customer-order-sms") expect((await processOutboxEvent(row.id, { consumers: failing })).outcome).toBe("failed");
    expect(await snapshot()).toBe(before);
  });
});

describe("operator visibility", () => {
  it("status reports counts, the oldest undelivered event and recent failures; retry is OWNER-only; anonymous is refused", async () => {
    const failed = await testEvent();
    await prisma.outboxEvent.update({ where: { id: failed.id }, data: { status: "FAILED", lastError: "boom", attempts: 3 } });
    const api = await asOwner();
    const res = await api.get("/api/v1/outbox/status");
    expect(res.status).toBe(200);
    expect(res.body.counts.FAILED).toBeGreaterThanOrEqual(1);
    expect(res.body.recentFailures.some((f: { id: string; lastError: string; attempts: number }) => f.id === failed.id && f.lastError === "boom" && f.attempts === 3)).toBe(true);
    expect(res.body).toHaveProperty("oldestUndelivered");
    expect(res.body.dispatcher).toHaveProperty("healthy");
    expect((await api.post(`/api/v1/outbox/${failed.id}/retry`)).status).toBe(200);
    expect((await api.post(`/api/v1/outbox/${failed.id}/retry`)).status).toBe(409);
    expect((await request(app).get("/api/v1/outbox/status")).status).toBe(401);
  });
});

describe("BullMQ transport (Redis connected only)", () => {
  it("record → dispatch → BullMQ → worker → processed; a duplicate job id is enqueued once", async () => {
    // The BullMQ connection (offline queue on) — the cache client drops the first command while it connects.
    const reachable = await Promise.race([queueConnection.ping().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 1_500))]).catch(() => false);
    if (!reachable) {
      console.log("[outbox test] Redis unreachable — BullMQ transport test skipped (non-Redis mode)");
      return;
    }
    console.log("[outbox test] BullMQ transport test running against Redis");
    const name = `outbox-test-${RUN}`;
    const queue = new Queue(name, { connection: queueConnection });
    try {
      const e = await testEvent();
      await queue.add("deliver", { eventId: e.id }, { jobId: outboxJobId(e.id, 0) });
      await queue.add("deliver", { eventId: e.id }, { jobId: outboxJobId(e.id, 0) });
      expect((await queue.getJobCounts("waiting")).waiting).toBe(1);
      await queue.obliterate({ force: true });

      const { calls, consumers } = recorder();
      const done = new Promise<void>((resolve) => {
        const worker = new Worker(
          name,
          async (job) => {
            await processOutboxEvent((job.data as { eventId: string }).eventId, { consumers });
            resolve();
          },
          { connection: queueConnection },
        );
        worker.on("completed", () => void worker.close());
      });
      await dispatchOutbox({ onlyIds: [e.id], enqueue: async ({ eventId, jobId }) => void (await queue.add("deliver", { eventId }, { jobId })) });
      await done;
      expect([calls.length, (await rowOf(e.id)).status]).toEqual([1, "PROCESSED"]);
    } finally {
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    }
  });
});
