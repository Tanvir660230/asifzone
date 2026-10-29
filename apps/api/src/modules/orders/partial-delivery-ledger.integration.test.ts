import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { Prisma } from "@prisma/client";
import { backfillPartialDeliveryReturns, reconcilePartialDelivery, updateOrderStatus } from "./order.service";
import { getOrderPaymentSummary, recordManualPayment } from "../../domain/payments/payment-ledger.service";

// A reconciled partial delivery charges only what the customer kept (docs/PAYMENT_LEDGER.md §5c).

let admin: string;
beforeAll(async () => {
  admin = await ownerId();
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

/** A COD order of `qty` units at 1000 (+ 60 shipping unless free), partly delivered by the courier. */
async function partlyDelivered(qty: number, shipping = 60) {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: qty }]);
  await prisma.order.update({ where: { id: order.id }, data: { shippingFee: shipping, total: 1000 * qty + shipping } });
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "PARTIALLY_DELIVERED"] as const) await updateOrderStatus(order.id, { status: s }, admin);
  const [item] = await prisma.orderItem.findMany({ where: { orderId: order.id }, select: { id: true } });
  return { order, itemId: item!.id };
}

describe("partial delivery — the order charges what the customer kept", () => {
  it("before reconciling: the courier is done, so it collects nothing more", async () => {
    const { order } = await partlyDelivered(2);
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ codToCollect: 0, amountDue: 2060 });
  });

  it("kept 1 of 2: the returned unit's value comes off what is due; recording the kept part settles it", async () => {
    const { order, itemId } = await partlyDelivered(2);
    await reconcilePartialDelivery(order.id, { items: [{ orderItemId: itemId, returnedQuantity: 1 }] }, admin);
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ amountDue: 1060, codToCollect: 0, refundDue: 0 });
    const rr = await prisma.returnRequest.findFirstOrThrow({ where: { orderId: order.id } });
    expect(rr.lines).toMatchObject([{ orderItemId: itemId, quantity: 1, restocked: 0, writtenOff: 0, value: 1000 }]);

    await recordManualPayment(order.id, { amount: 1060, kind: "COD_COLLECTED" }, admin);
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ status: "PAID", amountDue: 0, overpaid: 0, refundDue: 0 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PARTIALLY_DELIVERED");
  });

  it("kept nothing: the order is Returned — nothing due, nothing for the courier", async () => {
    const { order, itemId } = await partlyDelivered(2, 0);
    await reconcilePartialDelivery(order.id, { items: [{ orderItemId: itemId, returnedQuantity: 2 }] }, admin);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { statusHistory: true, items: true } });
    expect(after.status).toBe("RETURNED");
    expect(after.statusHistory.some((h) => h.status === "RETURNED" && h.note?.includes("kept nothing"))).toBe(true);
    // The return is counted once (reconciliation), not twice (the Returned move).
    expect(after.items[0]!.returnedQuantity).toBe(2);
    expect(after.items[0]!.restockedQuantity).toBe(0); // the stock waits for the parcel (owner decision M2)
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ amountDue: 0, codToCollect: 0, refundDue: 0 });
  });

  it("backfill: an order reconciled before return values were recorded — dry run reports, --apply fixes", async () => {
    const { order, itemId } = await partlyDelivered(3);
    await reconcilePartialDelivery(order.id, { items: [{ orderItemId: itemId, returnedQuantity: 2 }] }, admin);
    const rr = await prisma.returnRequest.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.returnRequest.update({ where: { id: rr.id }, data: { lines: Prisma.DbNull } }); // as old rows are
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ amountDue: 3060 });

    const dry = await backfillPartialDeliveryReturns();
    expect(dry.rows.find((r) => r.returnRequestId === rr.id)).toMatchObject({ value: 2000, keptNothing: false });
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ amountDue: 3060 });

    await backfillPartialDeliveryReturns({ apply: true });
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ amountDue: 1060 });
    expect((await backfillPartialDeliveryReturns()).rows.some((r) => r.returnRequestId === rr.id)).toBe(false);
  });
});
