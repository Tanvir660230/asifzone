import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { recordReturnDecision } from "../inventory/inventory.service";
import { getOrderById, listOrders, receiveReturnedParcel, updateOrderDetails, updateOrderStatus } from "./order.service";
import { isOrderFinished } from "./order-history";

// Order history: finished orders leave the daily work list and are listed on their own — the same Order rows, no copy.
// An order is finished only once nothing is left: money settled (COD in a courier payout), no review, the parcel back and
// inspected, no request waiting. Cancelled orders stay findable. A finished order's customer details are read-only.

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function order(quantity = 1) {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
  return placeOrder([{ variantId: variants[0]!.id, quantity }]);
}
async function move(id: string, ...statuses: Array<"CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED">) {
  const admin = await ownerId();
  for (const status of statuses) await updateOrderStatus(id, { status, note: status === "CANCELLED" ? "Customer changed their mind" : undefined }, admin);
}
const consignment = () => `9${Date.now()}${Math.random().toString().slice(2, 6)}`;
const inList = async (scope: "active" | "history", o: { id: string; orderNumber: string }) =>
  (await listOrders({ scope, search: o.orderNumber, page: 1, pageSize: 25 } as never)).items.some((x) => x.id === o.id);
const where = async (o: { id: string; orderNumber: string }) => ({ active: await inList("active", o), history: await inList("history", o) });

describe("order history", () => {
  it("an open order is work; a cancelled-before-booking order is history", async () => {
    const open = await order();
    expect(await where(open)).toEqual({ active: true, history: false });
    const cancelled = await order();
    await move(cancelled.id, "CANCELLED");
    expect(await where(cancelled)).toEqual({ active: false, history: true });
    expect(await isOrderFinished(cancelled.id)).toBe(true);
  });

  it("a delivered COD order stays work until the courier's payout settles it", async () => {
    const o = await order();
    const cid = consignment();
    await prisma.order.update({ where: { id: o.id }, data: { courierConsignmentId: cid, courierBookedAt: new Date() } });
    await move(o.id, "CONFIRMED", "SHIPPED", "DELIVERED");
    await prisma.order.update({ where: { id: o.id }, data: { paymentStatus: "PAID" } });
    const leg = await prisma.shipment.create({
      data: { orderId: o.id, parcelOrderId: o.id, type: "OUTBOUND", courier: "Steadfast", consignmentId: cid, operationalStatus: "DELIVERED", trackedByCourier: true },
    });
    expect(await where(o)).toEqual({ active: true, history: false });
    await prisma.shipment.update({ where: { id: leg.id }, data: { courierPayoutRef: "P-test-1" } });
    expect(await where(o)).toEqual({ active: false, history: true });
    // A leg flagged for review brings it back to the work list by itself.
    await prisma.shipment.update({ where: { id: leg.id }, data: { financialStatus: "NEEDS_REVIEW" } });
    expect(await where(o)).toEqual({ active: true, history: false });
  });

  it("delivered but unpaid is work", async () => {
    const o = await order();
    await move(o.id, "CONFIRMED", "SHIPPED", "DELIVERED");
    await prisma.order.update({ where: { id: o.id }, data: { paymentStatus: "UNPAID" } });
    expect(await where(o)).toEqual({ active: true, history: false });
  });

  it("a cancelled parcel is work until it is back and inspected", async () => {
    const o = await order();
    await prisma.order.update({ where: { id: o.id }, data: { courierConsignmentId: consignment(), courierBookedAt: new Date() } });
    await move(o.id, "CONFIRMED", "SHIPPED", "CANCELLED");
    expect(await where(o)).toEqual({ active: true, history: false }); // coming back
    await prisma.order.update({ where: { id: o.id }, data: { receivedBackAt: new Date() } });
    expect(await where(o)).toEqual({ active: true, history: false }); // in hand, to inspect
    await receiveReturnedParcel(o.id, await ownerId(), {});
    expect(await where(o)).toEqual({ active: false, history: true });
  });

  it("a second return on an order whose first parcel was already received is expected back again", async () => {
    const o = await order(2);
    await move(o.id, "CONFIRMED", "SHIPPED", "DELIVERED");
    await prisma.order.update({ where: { id: o.id }, data: { paymentStatus: "PAID" } });
    const [line] = await prisma.orderItem.findMany({ where: { orderId: o.id } });
    // First unit decided back (an exchange, say), received and inspected: finished.
    await prisma.$transaction((tx) => recordReturnDecision(tx, o.id, [{ orderItemId: line!.id, quantity: 1 }]));
    await receiveReturnedParcel(o.id, await ownerId(), {});
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).returnInspectedAt).toBeTruthy();
    expect(await where(o)).toEqual({ active: false, history: true });
    // The second unit: the earlier receipt no longer stands for it — back on the work list, under Coming back.
    await prisma.$transaction((tx) => recordReturnDecision(tx, o.id, [{ orderItemId: line!.id, quantity: 1 }]));
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.receivedBackAt).toBeNull();
    expect(after.returnInspectedAt).toBeNull();
    expect(await where(o)).toEqual({ active: true, history: false });
    await receiveReturnedParcel(o.id, await ownerId(), {});
    expect(await where(o)).toEqual({ active: false, history: true });
  });

  it("money held on a cancelled order, or a refund waiting, keeps it in the work list", async () => {
    const paid = await order();
    await move(paid.id, "CANCELLED");
    await prisma.order.update({ where: { id: paid.id }, data: { paymentStatus: "PAID" } });
    expect(await where(paid)).toEqual({ active: true, history: false });

    const refund = await order();
    await move(refund.id, "CANCELLED");
    expect(await where(refund)).toEqual({ active: false, history: true });
    await prisma.refund.create({ data: { orderId: refund.id, amount: 100, reason: "Test refund request" } as never });
    expect(await where(refund)).toEqual({ active: true, history: false });
  });

  it("history is searchable by tracking code and phone; the two lists split every order exactly", async () => {
    const o = await order();
    const cid = consignment();
    await prisma.order.update({ where: { id: o.id }, data: { courierConsignmentId: cid, trackingNumber: `T${cid}` } });
    await move(o.id, "CANCELLED"); // cancelled while pending: its stock went straight back
    const byTracking = await listOrders({ scope: "history", search: `T${cid}`, page: 1, pageSize: 25 } as never);
    expect(byTracking.items.map((x) => x.id)).toEqual([o.id]);
    const byConsignment = await listOrders({ scope: "history", search: cid, page: 1, pageSize: 25 } as never);
    expect(byConsignment.items.map((x) => x.id)).toEqual([o.id]);

    const total = (await listOrders({ page: 1, pageSize: 1 } as never)).total;
    const active = (await listOrders({ scope: "active", page: 1, pageSize: 1 } as never)).total;
    const history = (await listOrders({ scope: "history", page: 1, pageSize: 1 } as never)).total;
    expect(active + history).toBe(total);
  });

  it("a finished order's customer details are read-only; notes are not customer details", async () => {
    const o = await order();
    await move(o.id, "CANCELLED");
    await expect(updateOrderDetails(o.id, { customerName: "Someone Else" } as never, await ownerId())).rejects.toMatchObject({ statusCode: 409 });
    expect((await getOrderById(o.id)).customerName).not.toBe("Someone Else");
    await expect(updateOrderDetails(o.id, { adminNotes: "Called back, all fine" } as never, await ownerId())).resolves.toBeTruthy();
  });
});
