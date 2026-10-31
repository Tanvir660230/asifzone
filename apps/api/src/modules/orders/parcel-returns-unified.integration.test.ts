import { describe, it, expect, afterAll, afterEach } from "vitest";
import { financeBusinessUpdateSchema } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { getBusinessSettings } from "../../domain/finance/chart.service";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { adminAttention } from "../admin-home/attention.service";
import { getSettings, updateSettings } from "../settings/settings.service";
import { changeOrderStatus, orderWhereContext, parcelReturnSummary, receiveReturnedParcel } from "./order.service";
import { parcelQueueWhere } from "./parcel-queues";

// One list of parcels on their way back, one follow-up deadline: blueprint P1.5's "Parcels to receive" is Order
// Operations' Coming back / Return overdue / To inspect queues, and owner decision Q-B's deadline is the store's
// returnNotBackDays (FinanceBusiness.returnFollowUpDays was folded into it).

const DAY = 86_400_000;

afterEach(async () => {
  await updateSettings({ returnNotBackDays: 14 });
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

/** A shipped order of one unit — booked with Steadfast or sent without a booking. */
async function shippedOrder(opts: { booked: boolean }) {
  const owner = await ownerId();
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await changeOrderStatus(order.id, { status: "CONFIRMED", note: null }, owner);
  if (opts.booked) {
    await prisma.order.update({ where: { id: order.id }, data: { courierConsignmentId: `8${Date.now()}${Math.random().toString().slice(2, 6)}`, courierBookedAt: new Date() } });
  }
  await changeOrderStatus(order.id, { status: "PACKED", note: null }, owner);
  await changeOrderStatus(order.id, { status: "SHIPPED", note: null }, owner);
  return order;
}

/** Is this order in the queue, judged at `now` by the store's stored settings? */
async function inQueue(q: "comingBack" | "returnOverdue" | "inspectionPending", orderId: string, now = new Date()) {
  const ctx = await orderWhereContext(now);
  return (await prisma.order.count({ where: { id: orderId, deletedAt: null, ...parcelQueueWhere(q, ctx.now, ctx.parcel) } })) === 1;
}

describe("parcels on their way back — one queue (P1.5 on Order Operations)", () => {
  it("a parcel cancelled after shipping is coming back, booked with Steadfast or not; one cancelled before shipping never is", async () => {
    const owner = await ownerId();
    const booked = await shippedOrder({ booked: true });
    const unbooked = await shippedOrder({ booked: false });
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
    const packed = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    await changeOrderStatus(packed.id, { status: "CONFIRMED", note: null }, owner);
    await changeOrderStatus(packed.id, { status: "PACKED", note: null }, owner);
    for (const o of [booked, unbooked, packed]) await changeOrderStatus(o.id, { status: "CANCELLED", note: "refused" }, owner);

    expect(await inQueue("comingBack", booked.id)).toBe(true);
    expect(await inQueue("comingBack", unbooked.id)).toBe(true);
    expect(await inQueue("comingBack", packed.id)).toBe(false);
  });

  it("receiving it closes it everywhere: no longer coming back, nothing left to inspect, stock back once", async () => {
    const owner = await ownerId();
    const order = await shippedOrder({ booked: false });
    await changeOrderStatus(order.id, { status: "CANCELLED", note: "refused" }, owner);
    await receiveReturnedParcel(order.id, owner, { note: "back" });
    expect(await inQueue("comingBack", order.id)).toBe(false);
    expect(await inQueue("inspectionPending", order.id)).toBe(false);
    await expect(receiveReturnedParcel(order.id, owner, {})).rejects.toMatchObject({ details: { code: "NOTHING_TO_RECEIVE" } });
  });

  it("Home counts the same queues, and leaves them out for an admin without orders.read", async () => {
    const owner = await ownerId();
    const before = await parcelReturnSummary();
    const order = await shippedOrder({ booked: false });
    await changeOrderStatus(order.id, { status: "CANCELLED", note: "refused" }, owner);
    const after = await parcelReturnSummary();
    expect(after.comingBack - before.comingBack).toBe(1);

    const home = await adminAttention({ adminId: owner, role: "STAFF", permissions: ["orders.read"] });
    expect(home.parcelsToReceive).toMatchObject({ followUpDays: 14 });
    expect(home.parcelsToReceive!.total).toBeGreaterThanOrEqual(1);
    expect(typeof home.parcelsToReceive!.toInspect).toBe("number");
    expect((await adminAttention({ adminId: owner, role: "STAFF", permissions: ["payments.read"] })).parcelsToReceive).toBeNull();
  });
});

describe("one follow-up deadline — the store's returnNotBackDays (owner decision Q-B)", () => {
  it("overdue only once more than returnNotBackDays have passed since the courier's return was reported", async () => {
    const order = await shippedOrder({ booked: true });
    await changeOrderStatus(order.id, { status: "CANCELLED", note: "refused" }, await ownerId());
    const reported = new Date(Date.now() - 30 * DAY);
    await prisma.order.update({ where: { id: order.id }, data: { statusChangedAt: reported } });
    const at = (days: number, ms = 0) => new Date(reported.getTime() + days * DAY + ms);

    expect((await getSettings()).returnNotBackDays).toBe(14);
    expect(await inQueue("returnOverdue", order.id, at(13))).toBe(false);
    expect(await inQueue("returnOverdue", order.id, at(14))).toBe(false); // exactly 14 days: not yet
    expect(await inQueue("returnOverdue", order.id, at(14, 1))).toBe(true);
    // still coming back either way: overdue is a subset, never a second list
    expect(await inQueue("comingBack", order.id, at(14, 1))).toBe(true);
  });

  it("a stored deadline is what every reader uses — the queue, Home and the summary", async () => {
    const order = await shippedOrder({ booked: true });
    await changeOrderStatus(order.id, { status: "CANCELLED", note: "refused" }, await ownerId());
    const reported = new Date(Date.now() - 30 * DAY);
    await prisma.order.update({ where: { id: order.id }, data: { statusChangedAt: reported } });

    await updateSettings({ returnNotBackDays: 21 });
    const at = (days: number, ms = 0) => new Date(reported.getTime() + days * DAY + ms);
    expect(await inQueue("returnOverdue", order.id, at(15))).toBe(false); // the old 14-day default would have flagged it
    expect(await inQueue("returnOverdue", order.id, at(21))).toBe(false);
    expect(await inQueue("returnOverdue", order.id, at(21, 1))).toBe(true);
    expect((await parcelReturnSummary()).returnNotBackDays).toBe(21);
    expect((await adminAttention({ adminId: await ownerId(), role: "STAFF", permissions: ["orders.read"] })).parcelsToReceive?.followUpDays).toBe(21);
  });

  // The old column stays in the database (migrations only add — phase11.guard), but nothing reads or writes it.
  it("the finance settings no longer carry a second deadline", async () => {
    expect(await getBusinessSettings()).not.toHaveProperty("returnFollowUpDays");
    expect(financeBusinessUpdateSchema.safeParse({ returnFollowUpDays: 30 }).success).toBe(false);
  });
});
