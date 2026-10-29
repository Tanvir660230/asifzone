import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Steadfast is never called: each test says what Steadfast's status API answers per consignment (or that it is limiting us).
const courier = vi.hoisted(() => ({
  statuses: new Map<string, string>(),
  calls: [] as string[],
  rateLimitOn: new Set<string>(),
  delayMs: 0,
}));
vi.mock("../../providers/courier/steadfast", async () => {
  const { CourierRateLimitedError } = (await vi.importActual("../../providers/errors")) as { CourierRateLimitedError: new (retryAfterMs: number | null) => Error };
  return {
    createSteadfastConsignment: vi.fn(),
    createBulkSteadfastConsignments: vi.fn(),
    getSteadfastBalance: vi.fn(async () => 0),
    getSteadfastFraudCheck: vi.fn(async () => {
      throw new Error("no courier in tests");
    }),
    getSteadfastStatusByConsignmentId: vi.fn(async (cid: string) => {
      courier.calls.push(cid);
      if (courier.delayMs) await new Promise((r) => setTimeout(r, courier.delayMs));
      if (courier.rateLimitOn.has(cid)) throw new CourierRateLimitedError(30_000);
      return courier.statuses.get(cid) ?? "in_review";
    }),
  };
});
import request from "supertest";
import { app } from "../../app";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { getOrderStats, listOrders, updateOrderStatus } from "../orders/order.service";
import { bulkSyncCourierStatuses, syncPendingCourierStatuses } from "./courier.service";
import { orderListQuerySchema } from "@clothing-brand/shared";
import { getSteadfastStatusByConsignmentId } from "../../providers/courier/steadfast";

let admin: string;
let seq = Math.floor(Date.now() / 1000) * 1000 + 700;
const consignments: string[] = [];
let restoreIntegrations: () => void = () => {};
const startedAt = new Date();
beforeAll(async () => {
  admin = await ownerId();
  restoreIntegrations = overrideIntegrationsForTests({
    STEADFAST_API_KEY: "key",
    STEADFAST_SECRET_KEY: "secret",
    STEADFAST_WEBHOOK_TOKEN: "wh-phase0-secret",
  });
});
beforeEach(() => {
  courier.statuses.clear();
  courier.calls.length = 0;
  courier.rateLimitOn.clear();
  courier.delayMs = 0;
});
afterAll(async () => {
  restoreIntegrations();
  await prisma.courierWebhookEvent.deleteMany({ where: { consignmentId: { in: consignments } } });
  await prisma.courierStatusChange.deleteMany({ where: { consignmentId: { in: consignments } } });
  await prisma.courierWebhookRejection.deleteMany({ where: { receivedAt: { gte: startedAt } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

/** A shipped order booked with Steadfast `ageDays` ago, last known courier status `status`. */
async function booked(opts: { ageDays?: number; status?: string } = {}) {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  const consignmentId = String(++seq);
  consignments.push(consignmentId);
  await prisma.order.update({ where: { id: order.id }, data: { courierConsignmentId: consignmentId } });
  for (const s of ["CONFIRMED", "SHIPPED"] as const) await updateOrderStatus(order.id, { status: s }, admin);
  await prisma.order.update({
    where: { id: order.id },
    data: { courierBookedAt: new Date(Date.now() - (opts.ageDays ?? 0) * 86_400_000), courierStatus: opts.status ?? "in_review", courierNextPollAt: null },
  });
  return { order, consignmentId };
}

const hook = (body: object, headers: Record<string, string> = {}) => {
  let r = request(app).post("/api/courier/steadfast/webhook");
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(body);
};
const bearer = { Authorization: "Bearer wh-phase0-secret" };
const orderRow = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });

describe("webhook authentication and observability", () => {
  it("refuses a wrong or missing token, records only the reason, never the token or the body", async () => {
    const before = await prisma.courierWebhookRejection.count();
    expect((await hook({ consignment_id: 1 }, { Authorization: "Bearer not-the-token" })).status).toBe(401);
    expect((await hook({ consignment_id: 1, secret: "body-secret" })).status).toBe(401);
    const rows = await prisma.courierWebhookRejection.findMany({ orderBy: { receivedAt: "desc" }, take: 2 });
    expect((await prisma.courierWebhookRejection.count()) - before).toBe(2);
    expect(rows.map((r) => r.reason).sort()).toEqual(["bad_token", "missing_token"]);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain("not-the-token");
    expect(stored).not.toContain("body-secret");
  });

  it("records 'not configured' when the store has no webhook token", async () => {
    const restore = overrideIntegrationsForTests({ STEADFAST_WEBHOOK_TOKEN: "" });
    try {
      expect((await hook({ consignment_id: 1 }, bearer)).status).toBe(401);
    } finally {
      restore();
    }
    expect((await prisma.courierWebhookRejection.findFirstOrThrow({ orderBy: { receivedAt: "desc" } })).reason).toBe("not_configured");
  });

  it("applies the status Steadfast's API confirms, not the body's, and keeps both for the agreement check", async () => {
    const { order, consignmentId } = await booked();
    courier.statuses.set(consignmentId, "hold");
    expect((await hook({ consignment_id: Number(consignmentId), status: "delivered", cod_amount: 1000 }, bearer)).status).toBe(200);
    const row = await orderRow(order.id);
    expect(row.courierStatus).toBe("hold");
    expect(row.status).toBe("SHIPPED"); // the body's "delivered" was not trusted
    const event = await prisma.courierWebhookEvent.findFirstOrThrow({ where: { consignmentId } });
    expect(event).toMatchObject({ status: "delivered", verifiedStatus: "hold", outcome: "APPLIED" });
    const change = await prisma.courierStatusChange.findFirstOrThrow({ where: { consignmentId } });
    expect(change).toMatchObject({ fromStatus: "in_review", toStatus: "hold", source: "WEBHOOK" });
    expect(row.courierNextPollAt).not.toBeNull(); // the verification counts as a check: polling resumes on schedule
  });

  it("applies a retried event (same Idempotency-Key) once", async () => {
    const { order, consignmentId } = await booked();
    courier.statuses.set(consignmentId, "delivered");
    const body = { consignment_id: Number(consignmentId), status: "delivered", cod_amount: 1000 };
    for (let i = 0; i < 3; i++) expect((await hook(body, { ...bearer, "Idempotency-Key": `p0-${consignmentId}` })).status).toBe(200);
    expect(await prisma.courierWebhookEvent.count({ where: { consignmentId } })).toBe(1);
    expect((await orderRow(order.id)).status).toBe("DELIVERED");
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, status: "DELIVERED" } })).toBe(1);
    expect(courier.calls.filter((c) => c === consignmentId)).toHaveLength(1);
  });
});

describe("age-based polling", () => {
  it("checks a fresh parcel, then leaves it alone for 15 minutes; an old one for 6 hours", async () => {
    const fresh = await booked({ ageDays: 0 });
    const old = await booked({ ageDays: 20 });
    const ids = [fresh.order.id, old.order.id];
    const started = Date.now();
    const first = await syncPendingCourierStatuses({ orderIds: ids });
    expect(first.checked).toBe(2);
    expect(courier.calls.sort()).toEqual([fresh.consignmentId, old.consignmentId].sort());

    const nextFresh = (await orderRow(fresh.order.id)).courierNextPollAt!.getTime() - started;
    const nextOld = (await orderRow(old.order.id)).courierNextPollAt!.getTime() - started;
    expect(nextFresh).toBeGreaterThanOrEqual(15 * 60_000 - 5_000);
    expect(nextFresh).toBeLessThan(16 * 60_000);
    expect(nextOld).toBeGreaterThanOrEqual(6 * 3_600_000 - 5_000);

    courier.calls.length = 0;
    const second = await syncPendingCourierStatuses({ orderIds: ids });
    expect(second.checked).toBe(0);
    expect(courier.calls).toEqual([]);
  });

  it("records a status change found by polling as one the webhook did not bring", async () => {
    const { order, consignmentId } = await booked();
    courier.statuses.set(consignmentId, "delivered_approval_pending");
    await syncPendingCourierStatuses({ orderIds: [order.id] });
    expect(await prisma.courierStatusChange.findFirstOrThrow({ where: { consignmentId } })).toMatchObject({ toStatus: "delivered_approval_pending", source: "POLL" });
    expect((await orderRow(order.id)).status).toBe("SHIPPED"); // approval-pending is never final
  });

  it("does a bounded amount of work per run, oldest-due first", async () => {
    const a = await booked();
    const b = await booked();
    const result = await syncPendingCourierStatuses({ orderIds: [a.order.id, b.order.id], maxPerRun: 1 });
    expect(result.checked).toBe(1);
    expect(courier.calls).toHaveLength(1);
    expect(result.due).toBe(2);
  });

  it("stops the run when Steadfast rate-limits, leaving the rest due for the next run", async () => {
    const a = await booked();
    const b = await booked();
    courier.rateLimitOn.add(a.consignmentId);
    courier.rateLimitOn.add(b.consignmentId);
    const result = await syncPendingCourierStatuses({ orderIds: [a.order.id, b.order.id] });
    expect(result.rateLimited).toBe(true);
    expect(courier.calls).toHaveLength(1); // stopped after the first 429
    for (const id of [a.order.id, b.order.id]) {
      const row = await orderRow(id);
      expect(row.courierNextPollAt).toBeNull(); // still due
      expect(row.courierSyncError).toBeNull(); // a 429 is not a broken parcel
    }
  });

  it("re-schedules a parcel whose check failed, so it can't block the head of the queue", async () => {
    const { order, consignmentId } = await booked();
    vi.mocked(getSteadfastStatusByConsignmentId).mockImplementationOnce(async () => {
      courier.calls.push(consignmentId);
      throw new Error("The operation was aborted due to timeout");
    });
    await syncPendingCourierStatuses({ orderIds: [order.id] });
    const row = await orderRow(order.id);
    expect(row.courierSyncError).toContain("timeout");
    expect(row.courierNextPollAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("bulk sync", () => {
  it("stops before the proxy timeout and reports the rest as not checked", async () => {
    const a = await booked();
    const b = await booked();
    const c = await booked();
    courier.delayMs = 40;
    const result = await bulkSyncCourierStatuses([a.order.id, b.order.id, c.order.id], { budgetMs: 60 });
    expect(result.synced.length).toBeGreaterThanOrEqual(1);
    expect(result.synced.length + result.failed.length).toBe(3);
    expect(result.failed.length).toBeGreaterThanOrEqual(1);
    expect(result.failed.every((f) => f.reason.startsWith("Not checked"))).toBe(true);
  });

  it("stops on a rate limit and says so", async () => {
    const a = await booked();
    const b = await booked();
    courier.rateLimitOn.add(a.consignmentId);
    courier.rateLimitOn.add(b.consignmentId);
    const result = await bulkSyncCourierStatuses([a.order.id, b.order.id]);
    expect(result.synced).toEqual([]);
    expect(result.failed).toHaveLength(2);
    expect(courier.calls).toHaveLength(1);
    expect(result.failed.every((f) => /limiting/i.test(f.reason))).toBe(true);
  });
});

describe("courier exceptions queue", () => {
  it("lists unknown and approval-pending parcels next to holds and sync failures, and counts them in Needs action", async () => {
    const unknown = await booked({ status: "unknown" });
    const pending = await booked({ status: "partial_delivered_approval_pending" });
    const fine = await booked({ status: "in_review" });
    const query = (extra: Record<string, string>) => orderListQuerySchema.parse({ pageSize: "100", ...extra });
    const issueIds = new Set((await listOrders(query({ courierIssue: "true" }))).items.map((o) => o.id));
    expect(issueIds.has(unknown.order.id)).toBe(true);
    expect(issueIds.has(pending.order.id)).toBe(true);
    expect(issueIds.has(fine.order.id)).toBe(false);
    const actionIds = new Set((await listOrders(query({ needsAction: "true" }))).items.map((o) => o.id));
    expect(actionIds.has(unknown.order.id)).toBe(true);
    const stats = await getOrderStats();
    expect(stats.queueCounts.courierIssue).toBe((await listOrders(query({ courierIssue: "true" }))).total);
  });
});

describe("courier health report", () => {
  it("is owner/ops-readable, says the webhook is not proven without evidence, and keeps polling at full pace", async () => {
    expect((await request(app).get("/api/v1/ops/courier-health")).status).toBe(401);
    const res = await (await asOwner()).get("/api/v1/ops/courier-health");
    expect(res.status).toBe(200);
    expect(res.body.webhook.last48h.state).not.toBe("HEALTHY");
    expect(res.body.polling.level).toBe(0);
    expect(res.body.polling.maxLevel).toBe(0);
    expect(Array.isArray(res.body.webhook.last48h.checks)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("wh-phase0-secret");
  });
});
