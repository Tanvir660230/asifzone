import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../../modules/orders/order.service";
import { loadOrderFacts } from "../metrics/facts.repository";
import { getOrderPaymentSummary, reclassifyPayment, recordManualPayment, recordRefund, RETURNED_REFUND_DUE_WHERE } from "./payment-ledger.service";

// docs/PAYMENT_LEDGER.md §5a — a refused parcel's return charge is courier cost recovered, never money owed back.

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
}

/** A COD order for 1000 with free delivery (no shipping in the total). */
async function freeDeliveryOrder() {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await prisma.order.update({ where: { id: order.id }, data: { shippingFee: 0, total: 1000 } });
  return order;
}

async function stored(orderId: string) {
  return (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentStatus: true } })).paymentStatus;
}

describe("return charge — a refused free-delivery parcel", () => {
  it("the owner's case: 120 the rider collected, entered as COD collected, then Returned → re-marked, nothing owed back", async () => {
    const order = await freeDeliveryOrder();
    await updateOrderStatus(order.id, { status: "PARTIALLY_DELIVERED" }, admin);
    const { payment } = await recordManualPayment(order.id, { amount: 120, kind: "COD_COLLECTED" }, admin);
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);

    // Before: the ledger counts the charge as order money and asks for it back.
    const before = await getOrderPaymentSummary(order.id);
    expect([before.refundDue, before.returnCharge]).toEqual([120, 0]);
    expect(await prisma.order.count({ where: { id: order.id, ...RETURNED_REFUND_DUE_WHERE } })).toBe(1);

    const after = await reclassifyPayment(order.id, payment!.id, { purpose: "RETURN_CHARGE", reason: "rider collected the delivery charge" }, admin);
    expect(after).toMatchObject({ refundDue: 0, refundable: 0, paid: 0, returnCharge: 120, status: "UNPAID" });
    expect(after.payments[0]).toMatchObject({ id: payment!.id, purpose: "RETURN_CHARGE", amount: 120 });
    expect(await stored(order.id)).toBe("UNPAID");
    expect(await prisma.order.count({ where: { id: order.id, ...RETURNED_REFUND_DUE_WHERE } })).toBe(0);
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, select: { note: true } });
    expect(history.some((h) => h.note?.includes("marked as the return charge") && h.note.includes("rider collected"))).toBe(true);

    // A refund can't then be paid out of it.
    await refused(recordRefund(order.id, { amount: 120 }, admin), 400);

    // Repeat is a no-op; back to order money restores the refund due.
    await reclassifyPayment(order.id, payment!.id, { purpose: "RETURN_CHARGE" }, admin);
    const back = await reclassifyPayment(order.id, payment!.id, { purpose: "ORDER" }, admin);
    expect([back.refundDue, back.returnCharge]).toEqual([120, 0]);
    expect(await stored(order.id)).toBe("PARTIALLY_PAID");
  });

  it("recorded directly as a return charge on a returned order (rider or bKash) — order money stays apart", async () => {
    const order = await freeDeliveryOrder();
    await updateOrderStatus(order.id, { status: "PARTIALLY_DELIVERED" }, admin);
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);
    const viaRider = await recordManualPayment(order.id, { amount: 120, kind: "RETURN_CHARGE" }, admin);
    expect(viaRider.payment).toMatchObject({ provider: "COD", purpose: "RETURN_CHARGE" });
    const direct = await recordManualPayment(order.id, { amount: 60, kind: "RETURN_CHARGE", via: "DIRECT", method: "bKash" }, admin);
    expect(direct.payment).toMatchObject({ provider: "MANUAL", purpose: "RETURN_CHARGE", note: "bKash" });
    expect(direct.summary).toMatchObject({ returnCharge: 180, paid: 0, refundDue: 0, status: "UNPAID" });

    // Metrics and the books read it apart from order money.
    const [fact] = await loadOrderFacts([order.id], "BDT");
    expect(fact!.payments).toHaveLength(0);
    expect(fact!.returnCharges!.map((p) => p.amount).sort((a, b) => a - b)).toEqual([6000, 12000]);
  });

  it("guards: only on a refused parcel; never re-marks money already refunded; only COD / manual rows", async () => {
    const open = await freeDeliveryOrder();
    await refused(recordManualPayment(open.id, { amount: 120, kind: "RETURN_CHARGE" }, admin), 400, "PAYMENT_NOT_ALLOWED");

    const order = await freeDeliveryOrder();
    await updateOrderStatus(order.id, { status: "PARTIALLY_DELIVERED" }, admin);
    const { payment } = await recordManualPayment(order.id, { amount: 500, kind: "COD_COLLECTED" }, admin);
    await recordRefund(order.id, { amount: 400 }, admin);
    await refused(reclassifyPayment(order.id, payment!.id, { purpose: "RETURN_CHARGE" }, admin), 400, "PAYMENT_ALREADY_REFUNDED");

    const gateway = await prisma.payment.create({ data: { orderId: order.id, provider: "EPS_PG", status: "SUCCEEDED", amount: 10 } });
    await refused(reclassifyPayment(order.id, gateway.id, { purpose: "RETURN_CHARGE" }, admin), 400, "PAYMENT_NOT_ALLOWED");
    await refused(reclassifyPayment(order.id, "nope", { purpose: "RETURN_CHARGE" }, admin), 404);
  });

  it("HTTP: POST /payments kind RETURN_CHARGE and PATCH /payments/:id", async () => {
    const api = await asOwner();
    const order = await freeDeliveryOrder();
    await updateOrderStatus(order.id, { status: "PARTIALLY_DELIVERED" }, admin);
    const paid = await api.post(`/api/orders/${order.id}/payments`, { amount: 120, kind: "COD_COLLECTED" });
    expect(paid.status).toBe(201);
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);

    const bad = await api.patch(`/api/orders/${order.id}/payments/${paid.body.payment.id}`, { purpose: "SOMETHING" });
    expect(bad.status).toBe(400);
    const res = await api.patch(`/api/orders/${order.id}/payments/${paid.body.payment.id}`, { purpose: "RETURN_CHARGE" });
    expect(res.status).toBe(200);
    expect(res.body.payment).toMatchObject({ refundDue: 0, returnCharge: 120 });

    const extra = await api.post(`/api/orders/${order.id}/payments`, { amount: 20, kind: "RETURN_CHARGE", via: "DIRECT" });
    expect(extra.status).toBe(201);
    expect(extra.body.summary).toMatchObject({ returnCharge: 140, refundDue: 0 });
  });
});
