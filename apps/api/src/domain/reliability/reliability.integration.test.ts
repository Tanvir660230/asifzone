import { describe, it, expect, beforeAll, afterAll } from "vitest";
import https from "node:https";
import request from "supertest";
import { app } from "../../app";
import { env } from "../../config/env";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf, trackOrder } from "../../test-fixtures";
import { LiveProviderBlockedError, liveProvidersEnabled, networkGuardInstalled } from "../../lib/provider-guard";
import { sendSms } from "../../providers/sms/bulksmsbd";
import { receiveReturnedParcel, updateOrderStatus } from "../../modules/orders/order.service";
import { createOrder } from "../../modules/orders/order.service";
import { reviewReturnRequest, createReturnRequest } from "../../modules/return-requests/return-request.service";
import { bookOrderWithSteadfast, bookOrdersWithSteadfastBulk, COURIER_BOOKING_LEASE_MS, handleSteadfastWebhook } from "../../modules/courier/courier.service";
import { adjustRewardPoints, loyaltyDrift } from "../../modules/customers/customer.service";
import { recordRefund } from "../payments/payment-ledger.service";
import { recordReturnDecision } from "../../modules/inventory/inventory.service";
import { cleanupOutbox } from "../outbox/processor";
import { checkout } from "../../test-fixtures";

// Phase 9 (docs/history/PHASE_9_AUDIT.md): critical commerce operations stay correct under retries, concurrency, provider
// failures and recovery; automated tests can't reach a live provider.

let admin: string;
const ROUNDS = 5;
const realFetch = globalThis.fetch;
let restoreSteadfast: () => void = () => {};

beforeAll(async () => {
  admin = await ownerId();
  // The courier adapter requires configured keys; tests use placeholders and stub every Steadfast response.
  restoreSteadfast = overrideIntegrationsForTests({ STEADFAST_API_KEY: "test-key", STEADFAST_SECRET_KEY: "test-secret", STEADFAST_BASE_URL: "https://steadfast.invalid/api/v1" });
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  restoreSteadfast();
  await cleanupFixtures();
  await prisma.$disconnect();
});

/** Loyalty tests use customers no other test file touches: the shared fixture customer's points change under parallel files. */
const LOYALTY_PHONE = { deductions: "01799900091", drift: "01799900092" };

async function deliveredOrder(customerPhone?: string) {
  const { variants } = await createStockedProduct({ stocks: [10, 10], basePrice: 1000, variantPrices: [null, 1000] });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], customerPhone ? { customerPhone } : {});
  await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
  return { order, variants };
}

/** Stubs Steadfast: every create_order call is counted and answered after `delayMs`. */
/** Consignment ids unique across the whole file (and runs) — the webhook finds its order by consignment id. */
let consignmentSeq = Math.floor(Date.now() / 1000) * 1000;

function stubSteadfast(behaviour: "success" | "timeout" | "reject" = "success", delayMs = 30, opts: { knownInvoices?: string[] } = {}) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (!url.includes("steadfast.invalid")) return realFetch(input as string, init as RequestInit);
    // Invoice lookups aren't bookings: not counted. Steadfast answers an unknown invoice with 401 "Unauthorized Access".
    const invoice = url.match(/\/status_by_invoice\/(.+)$/)?.[1];
    if (invoice) {
      return (opts.knownInvoices ?? []).includes(decodeURIComponent(invoice))
        ? new Response(JSON.stringify({ status: 200, delivery_status: "in_review" }), { status: 200 })
        : new Response("Unauthorized Access", { status: 401 });
    }
    const cid = url.match(/\/status_by_cid\/(\d+)$/)?.[1];
    if (cid) return new Response(JSON.stringify({ status: 200, delivery_status: "in_review" }), { status: 200 });
    calls.push(url);
    await new Promise((r) => setTimeout(r, delayMs));
    if (behaviour === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    if (url.endsWith("/create_order/bulk-order")) {
      const payload = JSON.parse(JSON.parse(String(init?.body)).data) as Array<{ invoice: string }>;
      return new Response(JSON.stringify({ status: 200, data: payload.map((p) => ({ invoice: p.invoice, consignment_id: ++consignmentSeq, tracking_code: `TRK${consignmentSeq}`, status: "success" })) }), { status: 200 });
    }
    if (behaviour === "reject") return new Response(JSON.stringify({ status: 400, message: "Invalid recipient phone" }), { status: 200 });
    consignmentSeq++;
    return new Response(JSON.stringify({ status: 200, consignment: { consignment_id: consignmentSeq, tracking_code: `TRK-S${consignmentSeq}`, status: "in_review", tracking_link: "https://t.invalid" } }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

describe("provider isolation (D-8)", () => {
  it("tests run with live providers off and the network guard installed; external hosts are refused", async () => {
    expect(liveProvidersEnabled()).toBe(false);
    expect(networkGuardInstalled()).toBe(true);
    await expect(fetch("https://portal.packzy.com/api/v1/get_balance")).rejects.toBeInstanceOf(LiveProviderBlockedError);
    await expect(fetch("https://bulksmsbd.net/api/smsapi")).rejects.toBeInstanceOf(LiveProviderBlockedError);
    expect(() => https.request("https://pgapi.eps.com.bd/v1/token")).toThrow(LiveProviderBlockedError);
    expect(() => https.request({ hostname: "graph.facebook.com", path: "/" })).toThrow(LiveProviderBlockedError);
    const health = await request(app).get("/health");
    expect(health.body).toEqual({ status: "ok", liveProviders: false });
  });

  it("the SMS adapter never dials out when live providers are off, even with a key configured", async () => {
    let restoreSms: () => void = () => {};
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("should not be called");
    }) as typeof fetch;
    try {
      restoreSms = overrideIntegrationsForTests({ BULKSMSBD_API_KEY: "a-real-looking-key" });
      await sendSms({ to: "01700000000", body: "test" });
      expect(called).toBe(false);
    } finally {
      restoreSms();
      globalThis.fetch = realFetch;
    }
  });
});

describe("exchange fulfilment (D-1)", () => {
  it("a second exchange of an already-exchanged line is refused and rolls back entirely — no second replacement ships", async () => {
    const { order, variants } = await deliveredOrder();
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const mkRequest = () =>
      prisma.returnRequest.create({ data: { orderId: order.id, customerId: order.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: line.id, requestedVariantId: variants[1]!.id } });
    const first = await mkRequest();
    await reviewReturnRequest(first.id, { status: "APPROVED" }, admin);
    trackOrder((await prisma.returnRequest.findUniqueOrThrow({ where: { id: first.id } })).exchangeOrderId!);
    const stockBefore = await stockOf(variants[1]!.id);
    const replacementsBefore = await prisma.returnRequest.count({ where: { orderId: order.id, exchangeOrderId: { not: null } } });

    const second = await mkRequest(); // bypasses the creation guard, as a racing request would
    await expect(reviewReturnRequest(second.id, { status: "APPROVED" }, admin)).rejects.toMatchObject({ statusCode: 409 });
    expect(await stockOf(variants[1]!.id)).toBe(stockBefore);
    expect(await prisma.returnRequest.count({ where: { orderId: order.id, exchangeOrderId: { not: null } } })).toBe(replacementsBefore);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("PENDING"); // the claim rolled back too
    await expect(createReturnRequest(order.customerId!, { orderId: order.id, type: "EXCHANGE", reason: "again", orderItemId: line.id, requestedVariantId: variants[1]!.id } as never)).rejects.toMatchObject({ statusCode: 409 });
  });

  it(`an exchange approval racing a return of the same line: the units come back once, never a free replacement (${ROUNDS} rounds)`, async () => {
    // (Two PENDING requests per order can't coexist — a partial unique index enforces it — so the race that matters is the
    // exchange against another path that restocks the same line.)
    const outcomes: string[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const { order, variants } = await deliveredOrder();
      const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      const req = await prisma.returnRequest.create({ data: { orderId: order.id, customerId: order.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: line.id, requestedVariantId: variants[1]!.id } });
      const [exchange] = await Promise.allSettled([reviewReturnRequest(req.id, { status: "APPROVED" }, admin), updateOrderStatus(order.id, { status: "RETURNED" }, admin)]);
      const row = await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } });
      if (row.exchangeOrderId) trackOrder(row.exchangeOrderId);
      // Invariant: the line's unit is returned exactly once, and a replacement exists only if the exchange won that unit.
      const returnedUnits = (await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } })).returnedQuantity;
      const replacement = row.exchangeOrderId !== null;
      expect(returnedUnits).toBe(1);
      // Its parcel, received, restocks it once (owner decision M2: never at the decision).
      await receiveReturnedParcel(order.id, admin, {});
      const restocked = (await prisma.stockMovement.aggregate({ where: { orderId: order.id, variantId: line.variantId, reason: "RETURN" }, _sum: { change: true } }))._sum.change ?? 0;
      expect(restocked).toBe(1);
      expect(replacement).toBe(exchange.status === "fulfilled");
      outcomes.push(returnedUnits === 1 ? "ok" : `returned ${returnedUnits}`);
    }
    expect(outcomes).toEqual(Array(ROUNDS).fill("ok"));
  });

  it("deterministic interleaving: the line is returned after the approval's pre-check but before its release — the approval rolls back, no free replacement", async () => {
    const { order, variants } = await deliveredOrder();
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const req = await prisma.returnRequest.create({ data: { orderId: order.id, customerId: order.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: line.id, requestedVariantId: variants[1]!.id } });
    const replacementStock = await stockOf(variants[1]!.id);
    let approval: Promise<unknown> = Promise.resolve();
    await prisma.$transaction(
      async (tx) => {
        // Hold the replacement variant's row: the approval passes its pre-check, then blocks in recordSale on this lock…
        await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${variants[1]!.id} FOR UPDATE`;
        approval = reviewReturnRequest(req.id, { status: "APPROVED" }, admin).then(() => "approved", (err: unknown) => err);
        const deadline = Date.now() + 10_000;
        for (;;) {
          const [waiting] = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
          if ((waiting?.n ?? 0) > 0) break;
          if (Date.now() > deadline) throw new Error("the approval never reached the replacement-stock lock");
          await new Promise((r) => setTimeout(r, 20));
        }
        // …while another path returns the same line and commits first.
        await recordReturnDecision(tx, order.id, [{ orderItemId: line.id, quantity: line.quantity }]);
      },
      { timeout: 15_000 },
    );
    expect(await approval).toMatchObject({ statusCode: 409 });
    const row = await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } });
    if (row.exchangeOrderId) trackOrder(row.exchangeOrderId);
    expect(row.exchangeOrderId).toBeNull();
    expect(row.status).toBe("PENDING"); // the whole approval rolled back
    expect(await stockOf(variants[1]!.id)).toBe(replacementStock);
    // The other path's return is counted once; nothing went back into stock yet (it waits for the parcel — owner decision M2).
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } })).returnedQuantity).toBe(1);
    expect(await prisma.stockMovement.count({ where: { orderId: order.id, variantId: line.variantId, reason: "RETURN" } })).toBe(0);
  });
});

describe("courier booking (D-4)", () => {
  async function bookable() {
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    return placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  }

  it(`concurrent bookings of one order reach Steadfast once (${ROUNDS} rounds × 4 single + 1 bulk)`, async () => {
    const counts: string[] = [];
    try {
      for (let round = 0; round < ROUNDS; round++) {
        const order = await bookable();
        const calls = stubSteadfast("success", 40);
        const attempts: Array<Promise<unknown>> = [1, 2, 3, 4].map(() => bookOrderWithSteadfast(order.id));
        attempts.push(bookOrdersWithSteadfastBulk([order.id]));
        const results = await Promise.allSettled(attempts);
        const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { courierConsignmentId: true, courierBookingStartedAt: true } });
        const rejected = results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason?.statusCode);
        counts.push(`${calls.length}:${row.courierConsignmentId ? "booked" : "none"}:${row.courierBookingStartedAt === null ? "claim-cleared" : "claim-left"}:${rejected.every((c) => c === 409)}`);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(counts).toEqual(Array(ROUNDS).fill("1:booked:claim-cleared:true"));
  });

  it("unknown outcome (timeout): the claim is kept and flagged — no automatic re-booking until the lease lapses; the ops report says it isn't safe to retry", async () => {
    const order = await bookable();
    stubSteadfast("timeout", 5);
    try {
      await expect(bookOrderWithSteadfast(order.id)).rejects.toMatchObject({ statusCode: 502, details: { code: "COURIER_OUTCOME_UNKNOWN" } });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row.courierBookingStartedAt).not.toBeNull();
      expect(row.courierSyncError).toMatch(/Booking outcome unknown .* invoice/);
      const calls = stubSteadfast("success", 5);
      await expect(bookOrderWithSteadfast(order.id)).rejects.toMatchObject({ statusCode: 409 });
      expect(calls).toHaveLength(0);

      const report = await (await asOwner()).get("/api/v1/ops/reliability");
      const item = report.body.sections.courierBookings.items.find((i: { orderId: string }) => i.orderId === order.id);
      expect(item).toMatchObject({ outcomeUnknown: true, safeToRetry: false });

      await prisma.order.update({ where: { id: order.id }, data: { courierBookingStartedAt: new Date(Date.now() - COURIER_BOOKING_LEASE_MS - 1000) } });
      await bookOrderWithSteadfast(order.id); // after the lease an operator may book again
      expect(calls).toHaveLength(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).courierSyncError).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  /** An order whose booking answer was lost (timeout), with its lease already lapsed — the 2026-11-11 state. */
  async function lostBooking() {
    const order = await bookable();
    stubSteadfast("timeout", 5);
    await expect(bookOrderWithSteadfast(order.id)).rejects.toMatchObject({ details: { code: "COURIER_OUTCOME_UNKNOWN" } });
    await prisma.order.update({ where: { id: order.id }, data: { courierBookingStartedAt: new Date(Date.now() - COURIER_BOOKING_LEASE_MS - 1000) } });
    return order;
  }

  it("lost answer, but Steadfast created the parcel: booking again (single or bulk) is refused — no second parcel", async () => {
    try {
      const order = await lostBooking();
      const calls = stubSteadfast("success", 5, { knownInvoices: [order.orderNumber] });
      await expect(bookOrderWithSteadfast(order.id)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/already has a parcel .* link it/) });
      await prisma.order.update({ where: { id: order.id }, data: { courierBookingStartedAt: new Date(Date.now() - COURIER_BOOKING_LEASE_MS - 1000) } });
      const bulk = await bookOrdersWithSteadfastBulk([order.id]);
      expect(bulk.booked).toHaveLength(0);
      expect(bulk.failed[0]?.reason).toMatch(/already has a parcel/);
      expect(calls).toHaveLength(0);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row.courierConsignmentId).toBeNull();
      expect(row.courierBookingStartedAt).not.toBeNull(); // still held: the lost booking is not forgotten
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("lost answer and Steadfast has no parcel for the invoice: booking again goes through", async () => {
    try {
      const order = await lostBooking();
      const calls = stubSteadfast("success", 5);
      await bookOrderWithSteadfast(order.id);
      expect(calls).toHaveLength(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).courierConsignmentId).not.toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("staff link the parcel Steadfast already holds: the order is booked and SHIPPED, the lost-booking flag cleared", async () => {
    try {
      const order = await lostBooking();
      stubSteadfast("success", 5, { knownInvoices: [order.orderNumber] });
      const cid = String(++consignmentSeq);
      const owner = await asOwner();
      const linked = await owner.post(`/api/orders/${order.id}/courier/link`, { consignmentId: cid, trackingCode: `sfr${cid}bd` });
      expect(linked.status).toBe(200);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row).toMatchObject({ courierConsignmentId: cid, trackingNumber: `SFR${cid}BD`, carrier: "Steadfast", status: "SHIPPED", courierSyncError: null, courierBookingStartedAt: null, courierStatus: "in_review" });

      const other = await lostBooking();
      stubSteadfast("success", 5);
      const again = await owner.post(`/api/orders/${other.id}/courier/link`, { consignmentId: cid, trackingCode: `SFR${cid}BD` });
      expect(again.status).toBe(409); // one consignment, one order
      const bad = await owner.post(`/api/orders/${other.id}/courier/link`, { consignmentId: "12ab", trackingCode: "x" });
      expect(bad.status).toBe(400);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("a Steadfast update naming the invoice of a lost booking attaches the parcel; one naming an ordinary unbooked order does not", async () => {
    try {
      const order = await lostBooking();
      const plain = await bookable();
      stubSteadfast("success", 5);
      const cid = String(++consignmentSeq);
      await handleSteadfastWebhook({ consignment_id: Number(cid), invoice: order.orderNumber, tracking_id: `SFR${cid}BD`, notification_type: "tracking_update" });
      expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ courierConsignmentId: cid, trackingNumber: `SFR${cid}BD`, status: "SHIPPED", courierSyncError: null });

      const cid2 = String(++consignmentSeq);
      await handleSteadfastWebhook({ consignment_id: Number(cid2), invoice: plain.orderNumber, tracking_id: `SFR${cid2}BD` });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: plain.id } })).courierConsignmentId).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("a definite rejection releases the claim so the booking can be fixed and retried at once", async () => {
    const order = await bookable();
    stubSteadfast("reject", 5);
    try {
      await expect(bookOrderWithSteadfast(order.id)).rejects.toMatchObject({ statusCode: 400 });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).courierBookingStartedAt).toBeNull();
      stubSteadfast("success", 5);
      await bookOrderWithSteadfast(order.id);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).courierConsignmentId).not.toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("duplicate / reordered courier webhooks converge: one transition, one history entry", async () => {
    const order = await bookable();
    stubSteadfast("success", 5);
    try {
      await bookOrderWithSteadfast(order.id);
      const consignmentId = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).courierConsignmentId!;
      await updateOrderStatus(order.id, { status: "SHIPPED" }, admin); // handed to the courier
      globalThis.fetch = (async (input: unknown) => {
        if (String(input).includes("/status_by_cid/")) return new Response(JSON.stringify({ status: 200, delivery_status: "delivered" }), { status: 200 });
        return realFetch(input as string);
      }) as typeof fetch;
      await Promise.all([1, 2, 3].map(() => handleSteadfastWebhook({ consignment_id: consignmentId })));
      await handleSteadfastWebhook({ consignment_id: consignmentId });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED");
      expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, status: "DELIVERED" } })).toBe(1);
      expect(await prisma.payment.count({ where: { orderId: order.id, provider: "COD", status: "SUCCEEDED" } })).toBe(1);
      // …and one admin notification: the losers of the race are quiet no-ops (notify is fire-and-forget — let it land).
      await new Promise((r) => setTimeout(r, 300));
      expect(await prisma.notification.count({ where: { type: "order.courier_update", link: `/admin/orders/${order.id}` } })).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
      await prisma.notification.deleteMany({ where: { link: `/admin/orders/${order.id}` } });
    }
  });
});

describe("idempotent money operations (D-2, D-3) — database-backed, no Redis needed", () => {
  it(`concurrent checkouts with one Idempotency-Key create one order (${ROUNDS} rounds)`, async () => {
    const counts: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const { variants } = await createStockedProduct({ stocks: [10] });
      const key = `p9-checkout-${Date.now()}-${round}-${Math.random().toString(36).slice(2)}`;
      const input = checkout([{ variantId: variants[0]!.id, quantity: 1 }]);
      const orders = await Promise.allSettled([1, 2, 3].map(() => createOrder({ ...input, sessionId: undefined }, null, { idempotencyKey: key })));
      const ids = new Set(orders.filter((o) => o.status === "fulfilled").map((o) => (o as PromiseFulfilledResult<{ id: string }>).value.id));
      for (const id of ids) trackOrder(id);
      counts.push(await prisma.order.count({ where: { idempotencyKey: key } }));
      expect(ids.size).toBe(1);
    }
    expect(counts).toEqual(Array(ROUNDS).fill(1));
  });

  it(`concurrent refunds with one key record one refund; a different key is a second refund (${ROUNDS} rounds)`, async () => {
    const counts: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const { order } = await deliveredOrder();
      const key = `p9-refund-${order.id}`;
      await Promise.allSettled([1, 2, 3].map(() => recordRefund(order.id, { amount: 100 }, admin, key)));
      counts.push(await prisma.refund.count({ where: { orderId: order.id } }));
      await recordRefund(order.id, { amount: 100 }, admin, `${key}-second`);
      expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(2);
    }
    expect(counts).toEqual(Array(ROUNDS).fill(1));
  });

  it("the HTTP refund endpoint honours the Idempotency-Key header", async () => {
    const { order } = await deliveredOrder();
    const api = await asOwner();
    const first = await api.post(`/api/orders/${order.id}/refunds`, { amount: 50 }).set("Idempotency-Key", `p9-http-${order.id}`);
    const again = await api.post(`/api/orders/${order.id}/refunds`, { amount: 50 }).set("Idempotency-Key", `p9-http-${order.id}`);
    expect([200, 201]).toContain(first.status);
    expect(again.status).toBe(first.status);
    expect(again.body.refund?.id ?? again.body.id).toBe(first.body.refund?.id ?? first.body.id);
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
  });
});

describe("loyalty (D-6, D-7)", () => {
  it(`concurrent manual deductions can't take a balance below zero (${ROUNDS} rounds)`, async () => {
    const balances: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const { order } = await deliveredOrder(LOYALTY_PHONE.deductions);
      const customerId = order.customerId!;
      // A known start: this test-owned customer persists across runs (and a mutation run deliberately drives it negative).
      await prisma.rewardPointsEntry.deleteMany({ where: { customerId } });
      await prisma.customer.update({ where: { id: customerId }, data: { rewardPoints: 0 } });
      await adjustRewardPoints(customerId, 100, "seed");
      const before = (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).rewardPoints;
      const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => adjustRewardPoints(customerId, -Math.ceil(before / 2), "concurrent deduction")));
      const after = (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).rewardPoints;
      expect(results.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(2);
      balances.push(after);
    }
    expect(balances.every((b) => b >= 0)).toBe(true);
  });

  it("drift between the balance and the points ledger is detected (report only, never auto-corrected)", async () => {
    const { order } = await deliveredOrder(LOYALTY_PHONE.drift);
    const customerId = order.customerId!;
    const before = (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).rewardPoints;
    try {
      await prisma.customer.update({ where: { id: customerId }, data: { rewardPoints: { increment: 7 } } }); // a write that bypassed the ledger
      expect((await loyaltyDrift(1000)).some((d) => d.customerId === customerId)).toBe(true);
      const report = await (await asOwner()).get("/api/v1/ops/reliability");
      expect(report.body.sections.loyaltyDrift.count).toBeGreaterThanOrEqual(1);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).rewardPoints).toBe(before + 7); // not repaired
    } finally {
      await prisma.customer.update({ where: { id: customerId }, data: { rewardPoints: before } });
    }
  });
});

describe("recovery and operator visibility", () => {
  it("outbox cleanup never deletes active or failed work, however old", async () => {
    const old = new Date(Date.now() - 90 * 86_400_000);
    const rows = await Promise.all(
      (["PENDING", "ENQUEUED", "PROCESSING", "FAILED"] as const).map((status, i) =>
        prisma.outboxEvent.create({ data: { eventType: "test.happened.v1", consumer: "test-consumer", eventKey: `p9-cleanup-${Date.now()}-${i}`, aggregateType: "Test", aggregateId: `p9-${i}`, payload: {}, status, createdAt: old, processedAt: old } }),
      ),
    );
    try {
      await cleanupOutbox();
      expect(await prisma.outboxEvent.count({ where: { id: { in: rows.map((r) => r.id) } } })).toBe(4);
    } finally {
      await prisma.outboxEvent.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    }
  });

  it("the reliability report is admin-only and names every section", async () => {
    const res = await (await asOwner()).get("/api/v1/ops/reliability");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.sections).sort()).toEqual(["courierBookings", "loyaltyDrift", "outbox", "paymentLedgerDrift", "readModelDrift", "stockDrift", "stuckCampaigns"]);
    expect(typeof res.body.needsAttention).toBe("number");
    expect((await request(app).get("/api/v1/ops/reliability")).status).toBe(401);
  });
});
