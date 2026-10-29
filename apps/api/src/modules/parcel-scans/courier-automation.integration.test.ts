import { describe, it, expect, afterAll } from "vitest";
import { ORDER_QUEUE_FILTERS, businessDate } from "@clothing-brand/shared";
import { getTimezone } from "../../domain/config/commerce-settings";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { changeOrderStatus, listOrders } from "../orders/order.service";
import { runCourierAutomation } from "./courier-automation.service";

// Order Operations plan, phase 5 — the daily courier check. Acceptance: it surfaces parcels stuck in transit (6 days) and
// returns not back (14 days); it never writes stock, money, journals or an order's status (guard); one bell alert a day.

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

async function shippedOrder() {
  const owner = await ownerId();
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await changeOrderStatus(order.id, { status: "CONFIRMED", note: null }, owner);
  await prisma.order.update({ where: { id: order.id }, data: { courierConsignmentId: `7${Date.now()}${Math.random().toString().slice(2, 6)}`, courierBookedAt: new Date() } });
  await changeOrderStatus(order.id, { status: "PACKED", note: null }, owner);
  await changeOrderStatus(order.id, { status: "SHIPPED", note: null }, owner);
  return order;
}
const inQueue = async (q: "stuckInTransit" | "returnOverdue", order: { id: string; orderNumber: string }) =>
  (await listOrders({ ...ORDER_QUEUE_FILTERS[q], search: order.orderNumber, page: 1, pageSize: 25 } as never)).items.some((o) => o.id === order.id);

describe("courier automation", () => {
  it("finds stuck parcels and overdue returns by the store's thresholds", async () => {
    const stuck = await shippedOrder();
    await prisma.order.update({ where: { id: stuck.id }, data: { courierBookedAt: daysAgo(7) } });
    const recent = await shippedOrder();
    const scannedLongAgo = await shippedOrder();
    await prisma.order.update({ where: { id: scannedLongAgo.id }, data: { courierBookedAt: daysAgo(10), handedOverAt: daysAgo(2) } });

    const overdue = await shippedOrder();
    await changeOrderStatus(overdue.id, { status: "CANCELLED", note: "Customer refused the parcel" }, await ownerId());
    await prisma.order.update({ where: { id: overdue.id }, data: { statusChangedAt: daysAgo(15) } });
    const freshReturn = await shippedOrder();
    await changeOrderStatus(freshReturn.id, { status: "CANCELLED", note: "Customer refused the parcel" }, await ownerId());

    expect(await inQueue("stuckInTransit", stuck)).toBe(true);
    expect(await inQueue("stuckInTransit", recent)).toBe(false);
    // Counted from the handover scan when there is one (2 days), not from the booking (10).
    expect(await inQueue("stuckInTransit", scannedLongAgo)).toBe(false);
    expect(await inQueue("returnOverdue", overdue)).toBe(true);
    expect(await inQueue("returnOverdue", freshReturn)).toBe(false);
  });

  it("never writes stock, money, journals or an order status; alerts once a day; a failed payout read is reported, not fatal", async () => {
    const stuck = await shippedOrder();
    await prisma.order.update({ where: { id: stuck.id }, data: { courierBookedAt: daysAgo(8) } });
    const snapshot = async () => ({
      stock: await prisma.stockMovement.count(),
      payments: await prisma.payment.count(),
      journals: await prisma.journalEntry.count(),
      statuses: (await prisma.order.findMany({ where: { deletedAt: null }, select: { id: true, status: true }, orderBy: { id: "asc" } })).map((o) => `${o.id}:${o.status}`).join(","),
    });
    const before = await snapshot();
    // A fresh day row (an earlier run of this suite may have alerted today already).
    await prisma.courierAutomationRun.deleteMany({ where: { day: businessDate(new Date(), await getTimezone()) } });
    const alertsBefore = await prisma.notification.count({ where: { type: "courier.attention" } });

    const first = await runCourierAutomation({ payouts: false });
    expect(first.outcome).toBe("OK");
    expect(first.stuckInTransit).toBeGreaterThanOrEqual(1);
    // With live providers off the payout read fails: reported on the run, everything else still done.
    const second = await runCourierAutomation();
    expect(second.outcome).toBe("PARTIAL");
    expect(second.message).toMatch(/payouts/);
    expect(second.day).toBe(first.day);

    const after = await snapshot();
    expect(after).toEqual(before);
    // The notification is written fire-and-forget — give it a moment, then exactly one for the day.
    await new Promise((r) => setTimeout(r, 200));
    expect(await prisma.notification.count({ where: { type: "courier.attention" } })).toBe(alertsBefore + 1);
    expect(await prisma.courierAutomationRun.count({ where: { day: first.day } })).toBe(1);
  });
});
