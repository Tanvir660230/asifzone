import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The courier client is replaced so booking never reaches Steadfast; it records the cod_amount it was asked to collect.
const booked = vi.hoisted(() => [] as Array<{ invoice: string; codAmount: number }>);
vi.mock("../../lib/steadfast", () => ({
  createSteadfastConsignment: vi.fn(async (input: { invoice: string; codAmount: number }) => {
    booked.push({ invoice: input.invoice, codAmount: input.codAmount });
    return { consignment_id: Date.now(), tracking_code: `T${Date.now()}`, status: "in_review", tracking_link: null };
  }),
  createBulkSteadfastConsignments: vi.fn(async (inputs: Array<{ invoice: string; codAmount: number }>) =>
    inputs.map((input, i) => {
      booked.push({ invoice: input.invoice, codAmount: input.codAmount });
      return { invoice: input.invoice, consignment_id: Date.now() + i, tracking_code: `TB${i}`, status: "in_review", tracking_link: null };
    }),
  ),
  getSteadfastBalance: vi.fn(async () => 0),
  getSteadfastFraudCheck: vi.fn(async () => { throw new Error("no courier in tests"); }),
  getSteadfastStatusByConsignmentId: vi.fn(async () => "in_review"),
}));
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder, trackOrder } from "../../test-fixtures";
import { adjustOrderPrice, createManualOrder, updateOrderStatus } from "../../modules/orders/order.service";
import { refundOrderPayment, settlePaymentSession } from "../../modules/payments/payment.service";
import { reviewReturnRequest } from "../../modules/return-requests/return-request.service";
import { bookOrderWithSteadfast, bookOrdersWithSteadfastBulk } from "../../modules/courier/courier.service";
import {
  completeRefund,
  getOrderPaymentSummary,
  paymentLedgerDrift,
  recordManualPayment,
  recordRefund,
  repairPaymentLedger,
} from "./payment-ledger.service";

// docs/PAYMENT_LEDGER.md §13 — PL-1..PL-11 against a real database: domain service, state machine and HTTP contract.

let admin: string;
beforeAll(async () => {
  admin = await ownerId();
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function refused(promise: Promise<unknown>, status: number, code?: string) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err, "the command should have been refused").toBeInstanceOf(AppError);
  expect((err as AppError).statusCode).toBe(status);
  if (code) expect((err as AppError).details).toMatchObject({ code });
  return err as AppError;
}

async function stored(orderId: string) {
  return (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentStatus: true } })).paymentStatus;
}

/** PL-1: the stored projection equals the ledger's derivation. */
async function assertProjection(orderId: string) {
  const summary = await getOrderPaymentSummary(orderId);
  expect(await stored(orderId)).toBe(summary.status);
  return summary;
}

/** A COD order for 1000 + 60 shipping (Dhaka zone) = 1060. */
async function codOrder(qty = 1) {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
  return placeOrder([{ variantId: variants[0]!.id, quantity: qty }]);
}

async function gatewayPaidOrder() {
  const order = await codOrder();
  // Re-labelled as an online order paid through a gateway session (the settlement path under test).
  await prisma.order.update({ where: { id: order.id }, data: { paymentMethod: "EPS_PG" } });
  const session = await prisma.paymentSession.create({
    data: { orderId: order.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: `p4_${order.id}`, expiresAt: new Date(Date.now() + 60_000) },
  });
  await settlePaymentSession(session.gatewayTransactionRef, `eps_${order.id}`, Number(order.total));
  return { order, session };
}

describe("payment ledger — settlements", () => {
  it("PL-11: gateway settlement writes the Payment, the PAID projection and PENDING → CONFIRMED together", async () => {
    const { order } = await gatewayPaidOrder();
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect([after.status, after.paymentStatus]).toEqual(["CONFIRMED", "PAID"]);
    const summary = await assertProjection(order.id);
    expect([summary.paid, summary.amountDue, summary.refundable]).toEqual([1060, 0, 1060]);
  });

  it("a second gateway success on a paid order is recorded as an overpayment with a refund due", async () => {
    const { order } = await gatewayPaidOrder();
    const second = await prisma.paymentSession.create({
      data: { orderId: order.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: `p4b_${order.id}`, expiresAt: new Date(Date.now() + 60_000) },
    });
    await settlePaymentSession(second.gatewayTransactionRef, `eps2_${order.id}`, 1060);
    const summary = await assertProjection(order.id);
    expect([summary.status, summary.paid, summary.overpaid, summary.refundDue]).toEqual(["PAID", 2120, 1060, 1060]);
    // Refunding the duplicate leaves the order fully paid (not "partially refunded").
    await recordRefund(order.id, { amount: 1060, reason: "duplicate" }, admin);
    expect(await stored(order.id)).toBe("PAID");
  });

  it("PL-5: T4 records the COD collection as a Payment of the balance due (D1)", async () => {
    const order = await codOrder();
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
    const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
    expect(payments.map((p) => [p.provider, p.status, Number(p.amount)])).toEqual([["COD", "SUCCEEDED", 1060]]);
    expect((await assertProjection(order.id)).status).toBe("PAID");
    // Re-applying DELIVERED is a no-op — no second collection.
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("a part-prepaid COD order: the courier collects only the rest, and delivery records only the rest", async () => {
    const order = await codOrder();
    await recordManualPayment(order.id, { amount: 300, kind: "MANUAL", method: "bKash" }, admin);
    expect((await getOrderPaymentSummary(order.id)).codToCollect).toBe(760);
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
    const amounts = (await prisma.payment.findMany({ where: { orderId: order.id }, orderBy: { settledAt: "asc" } })).map((p) => Number(p.amount));
    expect(amounts.sort((a, b) => a - b)).toEqual([300, 760]);
    expect((await assertProjection(order.id)).status).toBe("PAID");
  });

  it("the admin 'mark paid' manual order is PAID with a MANUAL Payment written in the order's own transaction", async () => {
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const order = await createManualOrder(
      { items: [{ variantId: variants[0]!.id, quantity: 1 }], customerName: "Vitest Manual", customerPhone: "01712345670", shippingDivision: "Dhaka", shippingDistrict: "Dhaka", shippingArea: "Uttara", shippingAddressLine: "House 1", paymentMethod: "COD", markPaid: true } as never,
      admin,
    );
    trackOrder(order.id);
    expect(order.paymentStatus).toBe("PAID");
    expect(order.payment.payments.map((p) => [p.provider, p.amount])).toEqual([["MANUAL", 1060]]);
    // PL-6: a prepaid COD order owes the courier nothing.
    expect(order.payment.codToCollect).toBe(0);
  });
});

describe("payment ledger — refunds", () => {
  it("PL-2/PL-3: partial refunds are recorded, cumulate, and are capped by what was received", async () => {
    const { order } = await gatewayPaidOrder();
    await refundOrderPayment(order.id, { amount: 200 }, admin);
    let summary = await assertProjection(order.id);
    expect([summary.status, summary.refunded, summary.refundable]).toEqual(["PARTIALLY_REFUNDED", 200, 860]);

    await refused(refundOrderPayment(order.id, { amount: 861 }, admin), 400, "REFUND_EXCEEDS_REFUNDABLE");
    await refundOrderPayment(order.id, { amount: 860 }, admin);
    summary = await assertProjection(order.id);
    expect([summary.status, summary.refunded, summary.refundable]).toEqual(["REFUNDED", 1060, 0]);
    await refused(refundOrderPayment(order.id, { amount: 1 }, admin), 400, "NOTHING_TO_REFUND");
  });

  it("an unpaid order can't be refunded", async () => {
    const order = await codOrder();
    await refused(refundOrderPayment(order.id, { amount: 10 }, admin), 400, "NOTHING_TO_REFUND");
  });

  it("concurrent refunds serialise on the order lock — the total never exceeds what was received", async () => {
    const { order } = await gatewayPaidOrder();
    const results = await Promise.allSettled([700, 700, 700].map((amount) => refundOrderPayment(order.id, { amount }, admin)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const total = await prisma.refund.aggregate({ where: { orderId: order.id }, _sum: { amount: true } });
    expect(Number(total._sum.amount)).toBe(700);
    await assertProjection(order.id);
  });

  it("PL-10: an Idempotency-Key replays the same refund", async () => {
    const { order } = await gatewayPaidOrder();
    const key = `vitest-refund-${order.id}`;
    const a = await refundOrderPayment(order.id, { amount: 100 }, admin, key);
    const b = await refundOrderPayment(order.id, { amount: 100 }, admin, key);
    expect(b.id).toBe(a.id);
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("T8 still needs a full refund: PARTIALLY_REFUNDED does not allow the REFUNDED order status", async () => {
    const order = await codOrder();
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin);
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);
    await recordRefund(order.id, { amount: 500 }, admin);
    await refused(updateOrderStatus(order.id, { status: "REFUNDED" }, admin), 400);
    await recordRefund(order.id, { amount: 560 }, admin);
    const done = await updateOrderStatus(order.id, { status: "REFUNDED" }, admin);
    expect([done.status, done.paymentStatus]).toEqual(["REFUNDED", "REFUNDED"]);
  });

  it("a cancelled paid order is in the refund queue until fully refunded", async () => {
    const { order } = await gatewayPaidOrder();
    await updateOrderStatus(order.id, { status: "CANCELLED" }, admin);
    const inQueue = async () =>
      (await prisma.order.count({ where: { id: order.id, status: "CANCELLED", paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] } } })) === 1;
    expect(await inQueue()).toBe(true);
    await recordRefund(order.id, { amount: 400 }, admin);
    expect(await inQueue()).toBe(true);
    expect((await getOrderPaymentSummary(order.id)).refundDue).toBe(660);
    await recordRefund(order.id, { amount: 660 }, admin);
    expect(await inQueue()).toBe(false);
  });
});

describe("payment ledger — exchange downgrade (D6) and requested refunds", () => {
  async function approvedDowngrade() {
    const { variants } = await createStockedProduct({ stocks: [5, 5], basePrice: 1000, variantPrices: [null, 800] });
    const original = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    await updateOrderStatus(original.id, { status: "DELIVERED" }, admin);
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: original.id } });
    const req = await prisma.returnRequest.create({
      data: { orderId: original.id, customerId: original.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: line.id, requestedVariantId: variants[1]!.id },
    });
    await reviewReturnRequest(req.id, { status: "APPROVED" }, admin);
    const exchangeOrderId = (await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).exchangeOrderId!;
    trackOrder(exchangeOrderId);
    return { original, exchangeOrderId };
  }

  it("PL-8: the owed difference is a REQUESTED refund that reserves money, completable exactly once", async () => {
    const { original, exchangeOrderId } = await approvedDowngrade();
    let summary = await assertProjection(original.id);
    expect([summary.status, summary.refundPending, summary.refundable]).toEqual(["PAID", 200, 860]);
    const requested = summary.refunds.find((r) => r.status === "REQUESTED")!;

    // The free replacement is settled at zero in the ledger (PAID, nothing for the courier).
    const ex = await getOrderPaymentSummary(exchangeOrderId);
    expect([ex.status, ex.codToCollect]).toEqual(["PAID", 0]);

    await completeRefund(original.id, requested.id, { method: "bKash" }, admin);
    summary = await assertProjection(original.id);
    expect([summary.status, summary.refunded, summary.refundPending]).toEqual(["PARTIALLY_REFUNDED", 200, 0]);
    await refused(completeRefund(original.id, requested.id, {}, admin), 409, "REFUND_NOT_REQUESTED");
  });
});

describe("payment ledger — guards", () => {
  it("PL-7: a paid order's total can't be adjusted", async () => {
    const { order } = await gatewayPaidOrder();
    await refused(adjustOrderPrice(order.id, { priceAdjustment: -100 }, admin), 409, "ORDER_ALREADY_PAID");
    const unpaid = await codOrder();
    const adjusted = await adjustOrderPrice(unpaid.id, { priceAdjustment: -100 }, admin);
    expect(Number(adjusted.total)).toBe(960);
  });

  it("manual payments: never above the balance due, not on closed orders, not on a courier-booked COD order", async () => {
    const order = await codOrder();
    await refused(recordManualPayment(order.id, { amount: 1061, kind: "MANUAL" }, admin), 400, "PAYMENT_EXCEEDS_AMOUNT_DUE");
    await refused(recordManualPayment(order.id, { amount: 100, kind: "COD_COLLECTED" }, admin), 400, "PAYMENT_NOT_ALLOWED");
    await prisma.order.update({ where: { id: order.id }, data: { courierConsignmentId: `vitest-${order.id}` } });
    await refused(recordManualPayment(order.id, { amount: 100, kind: "MANUAL" }, admin), 400, "PAYMENT_NOT_ALLOWED");
    const cancelled = await codOrder();
    await updateOrderStatus(cancelled.id, { status: "CANCELLED" }, admin);
    await refused(recordManualPayment(cancelled.id, { amount: 100, kind: "MANUAL" }, admin), 400, "PAYMENT_NOT_ALLOWED");
  });

  it("partial delivery: the courier-collected cash is recorded, then it can be refunded", async () => {
    const order = await codOrder(2);
    await updateOrderStatus(order.id, { status: "PARTIALLY_DELIVERED" }, admin);
    await recordManualPayment(order.id, { amount: 1060, kind: "COD_COLLECTED" }, admin);
    const summary = await assertProjection(order.id);
    expect([summary.paid, summary.amountDue]).toEqual([1060, 1000]);
    await recordRefund(order.id, { amount: 100 }, admin);
    expect(await stored(order.id)).toBe("PARTIALLY_REFUNDED");
  });

  it("PL-6: courier booking (single and bulk) sends codToCollect — a prepaid COD order is booked for 0", async () => {
    const prepaid = await codOrder();
    await recordManualPayment(prepaid.id, { amount: 1060, kind: "MANUAL" }, admin);
    const partly = await codOrder();
    await recordManualPayment(partly.id, { amount: 60, kind: "MANUAL" }, admin);
    const plain = await codOrder();

    await bookOrderWithSteadfast(prepaid.id);
    await bookOrdersWithSteadfastBulk([partly.id, plain.id]);
    const amountFor = (orderNumber: string) => booked.find((b) => b.invoice === orderNumber)?.codAmount;
    expect(amountFor(prepaid.orderNumber)).toBe(0); // pre-Phase-4 code sent 1060: the customer would pay twice
    expect(amountFor(partly.orderNumber)).toBe(1000);
    expect(amountFor(plain.orderNumber)).toBe(1060);
  });
});

describe("payment ledger — reconciliation", () => {
  it("drift report finds a hand-edited projection and the repair (dry run first) fixes only that", async () => {
    const { order } = await gatewayPaidOrder();
    // Simulate drift: a legacy write outside the ledger.
    await prisma.$executeRaw`UPDATE "Order" SET "paymentStatus" = 'UNPAID' WHERE id = ${order.id}`;
    const report = await paymentLedgerDrift();
    expect(report.drift).toContainEqual(expect.objectContaining({ orderId: order.id, stored: "UNPAID", derived: "PAID" }));

    const dry = await repairPaymentLedger();
    expect(dry.applied).toBe(false);
    expect(await stored(order.id)).toBe("UNPAID");

    const applied = await repairPaymentLedger({ apply: true });
    expect(applied.changed.map((c) => c.orderId)).toContain(order.id);
    expect(await stored(order.id)).toBe("PAID");
    expect((await paymentLedgerDrift()).drift.find((d) => d.orderId === order.id)).toBeUndefined();
  });
});

describe("payment ledger — HTTP contract", () => {
  it("GET /payment, POST /payments, POST /refunds (+ error contract), POST /refunds/:id/complete, ledger drift", async () => {
    const api = await asOwner();
    const order = await codOrder();

    const summary = await api.get(`/api/orders/${order.id}/payment`);
    expect(summary.status).toBe(200);
    expect(summary.body.payment).toMatchObject({ status: "UNPAID", total: 1060, codToCollect: 1060, refundable: 0 });

    const tooMuch = await api.post(`/api/orders/${order.id}/payments`, { amount: 5000, kind: "MANUAL" });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.details).toMatchObject({ code: "PAYMENT_EXCEEDS_AMOUNT_DUE", amountDue: 1060 });

    const paid = await api.post(`/api/orders/${order.id}/payments`, { amount: 1060, kind: "MANUAL", method: "bKash" });
    expect(paid.status).toBe(201);
    expect(paid.body.summary).toMatchObject({ status: "PAID", paid: 1060, codToCollect: 0 });

    const over = await api.post(`/api/orders/${order.id}/refunds`, { amount: 2000 });
    expect(over.status).toBe(400);
    expect(over.body.details).toMatchObject({ code: "REFUND_EXCEEDS_REFUNDABLE", refundable: 1060 });

    const refund = await api.post(`/api/orders/${order.id}/refunds`, { amount: 60, method: "bKash" });
    expect(refund.status).toBe(201);
    expect(refund.body.refund).toMatchObject({ status: "COMPLETED" });
    expect(refund.body.summary).toMatchObject({ status: "PARTIALLY_REFUNDED", refunded: 60, refundable: 1000 });

    const detail = await api.get(`/api/orders/${order.id}`);
    expect(detail.body.order.payment).toMatchObject({ status: "PARTIALLY_REFUNDED", netPaid: 1000 });

    const missing = await api.post(`/api/orders/${order.id}/refunds/nope/complete`, {});
    expect(missing.status).toBe(404);

    const drift = await api.get(`/api/payment-admin/ledger/drift`);
    expect(drift.status).toBe(200);
    expect(drift.body).toHaveProperty("checked");
    const repair = await api.post(`/api/payment-admin/ledger/repair`, {});
    expect([repair.status, repair.body.applied]).toEqual([200, false]);
  });
});
