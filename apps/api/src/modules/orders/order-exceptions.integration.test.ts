import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { ORDER_EXCEPTION_IDS, describeParcel, type OrderExceptionId } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf } from "../../test-fixtures";
import { changeOrderStatus, listOrders } from "./order.service";
import { exceptionOrderIds, getOrderExceptionsBoard } from "./order-exceptions";

// Warehouse Operations §5 — the Exception Center. Acceptance: each exception finds exactly the orders whose facts match it
// and nothing else; a count equals the list ?exception= opens; Trash is left out; reading exceptions changes nothing; and
// the per-order parcel view (describeParcel) agrees with the server's predicate.

let owner: string;
let seq = 0;
const H = 3_600_000;

beforeAll(async () => {
  owner = await ownerId();
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

type Facts = Partial<{
  status: "CONFIRMED" | "PACKED" | "SHIPPED" | "DELIVERED" | "CANCELLED";
  courierStatus: string | null;
  bookedHoursAgo: number;
  handedOver: boolean;
  receivedBackHoursAgo: number;
  syncError: string;
}>;

/** An order with exactly the given facts. Status moves go through the state machine; courier facts are written as the
 * courier sync would leave them. */
async function orderWith(f: Facts) {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 400 });
  const o = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await changeOrderStatus(o.id, { status: "CONFIRMED", note: null }, owner);
  const bookedAt = f.bookedHoursAgo !== undefined ? new Date(Date.now() - f.bookedHoursAgo * H) : null;
  if (bookedAt) {
    await prisma.order.update({ where: { id: o.id }, data: { courierConsignmentId: `7${Date.now()}${seq++}`, courierBookedAt: bookedAt, trackingNumber: `EXC${Date.now()}${seq}` } });
  }
  const path: Record<NonNullable<Facts["status"]>, Array<"PACKED" | "SHIPPED" | "DELIVERED" | "CANCELLED">> = {
    CONFIRMED: [],
    PACKED: ["PACKED"],
    SHIPPED: ["PACKED", "SHIPPED"],
    DELIVERED: ["PACKED", "SHIPPED", "DELIVERED"],
    CANCELLED: ["CANCELLED"],
  };
  for (const s of path[f.status ?? "CONFIRMED"]) await changeOrderStatus(o.id, { status: s, note: s === "CANCELLED" ? "Customer refused" : null }, owner);
  await prisma.order.update({
    where: { id: o.id },
    data: {
      courierStatus: f.courierStatus ?? null,
      courierSyncError: f.syncError ?? null,
      handedOverAt: f.handedOver ? new Date() : null,
      receivedBackAt: f.receivedBackHoursAgo !== undefined ? new Date(Date.now() - f.receivedBackHoursAgo * H) : null,
    },
  });
  return prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
}

async function inException(id: OrderExceptionId, orderId: string) {
  return (await exceptionOrderIds(id)).includes(orderId);
}
/** Every exception this order is in. */
async function exceptionsOf(orderId: string) {
  const out: OrderExceptionId[] = [];
  for (const id of ORDER_EXCEPTION_IDS) if (await inException(id, orderId)) out.push(id);
  return out;
}

describe("exception predicates", () => {
  it("booked over a day, never handed over, courier silent → handoverOverdue; handed over or fresh → not", async () => {
    const late = await orderWith({ status: "SHIPPED", bookedHoursAgo: 30, courierStatus: "pending" });
    const fresh = await orderWith({ status: "SHIPPED", bookedHoursAgo: 2, courierStatus: "pending" });
    const handed = await orderWith({ status: "SHIPPED", bookedHoursAgo: 30, courierStatus: "pending", handedOver: true });
    const moving = await orderWith({ status: "SHIPPED", bookedHoursAgo: 30, courierStatus: "delivered_approval_pending" });
    expect(await exceptionsOf(late.id)).toEqual(["handoverOverdue"]);
    expect(await exceptionsOf(fresh.id)).toEqual([]);
    expect(await exceptionsOf(handed.id)).toEqual([]);
    expect(await inException("handoverOverdue", moving.id)).toBe(false);
  });

  it("hold, unknown and a failing sync on a parcel still out are each their own exception", async () => {
    expect(await exceptionsOf((await orderWith({ status: "SHIPPED", bookedHoursAgo: 1, courierStatus: "hold" })).id)).toEqual(["courierOnHold"]);
    expect(await exceptionsOf((await orderWith({ status: "SHIPPED", bookedHoursAgo: 1, courierStatus: "unknown" })).id)).toEqual(["courierUnknown"]);
    expect(await exceptionsOf((await orderWith({ status: "SHIPPED", bookedHoursAgo: 1, courierStatus: "unknown_approval_pending" })).id)).toEqual(["courierUnknown"]);
    expect(await exceptionsOf((await orderWith({ status: "SHIPPED", bookedHoursAgo: 1, courierStatus: "pending", syncError: "timeout" })).id)).toEqual(["courierSyncFailing"]);
  });

  it("a rider-reported delivery is late after three days of Steadfast's silence, counted from when that word was first seen", async () => {
    const late = await orderWith({ status: "SHIPPED", bookedHoursAgo: 200, courierStatus: "delivered_approval_pending" });
    await prisma.courierStatusChange.create({ data: { consignmentId: late.courierConsignmentId!, orderId: late.id, fromStatus: "pending", toStatus: "delivered_approval_pending", source: "poll", observedAt: new Date(Date.now() - 80 * H) } });
    const recent = await orderWith({ status: "SHIPPED", bookedHoursAgo: 200, courierStatus: "delivered_approval_pending" });
    await prisma.courierStatusChange.create({ data: { consignmentId: recent.courierConsignmentId!, orderId: recent.id, fromStatus: "pending", toStatus: "delivered_approval_pending", source: "webhook", observedAt: new Date(Date.now() - 5 * H) } });
    // No log row (before the log existed): the booking time stands in.
    const unlogged = await orderWith({ status: "SHIPPED", bookedHoursAgo: 100, courierStatus: "partial_delivered_approval_pending" });
    expect(await inException("deliveryConfirmOverdue", late.id)).toBe(true);
    expect(await inException("deliveryConfirmOverdue", recent.id)).toBe(false);
    expect(await inException("deliveryConfirmOverdue", unlogged.id)).toBe(true);
  });

  it("cancelled while Steadfast still expects to collect → cancelInCourierPanel; once Steadfast cancels, or it came back, not", async () => {
    const stillBooked = await orderWith({ status: "CANCELLED", bookedHoursAgo: 5, courierStatus: "pending" });
    const courierCancelled = await orderWith({ status: "CANCELLED", bookedHoursAgo: 5, courierStatus: "cancelled" });
    const back = await orderWith({ status: "CANCELLED", bookedHoursAgo: 5, courierStatus: "pending", receivedBackHoursAgo: 1 });
    const neverBooked = await orderWith({ status: "CANCELLED" });
    expect(await exceptionsOf(stillBooked.id)).toEqual(["cancelInCourierPanel"]);
    expect(await inException("cancelInCourierPanel", courierCancelled.id)).toBe(false);
    expect(await inException("cancelInCourierPanel", back.id)).toBe(false);
    expect(await exceptionsOf(neverBooked.id)).toEqual([]);
  });

  it("back for more than two days without inspection → inspectionOverdue", async () => {
    const old = await orderWith({ status: "CANCELLED", bookedHoursAgo: 100, courierStatus: "cancelled", receivedBackHoursAgo: 60 });
    const today = await orderWith({ status: "CANCELLED", bookedHoursAgo: 100, courierStatus: "cancelled", receivedBackHoursAgo: 3 });
    expect(await inException("inspectionOverdue", old.id)).toBe(true);
    expect(await inException("inspectionOverdue", today.id)).toBe(false);
  });

  it("names the historical conflicts: booked but Packed, Delivered vs the courier's partial / cancelled / silence", async () => {
    expect(await exceptionsOf((await orderWith({ status: "PACKED", bookedHoursAgo: 2, courierStatus: "delivered" })).id)).toEqual(["bookedButPacked"]);
    expect(await exceptionsOf((await orderWith({ status: "DELIVERED", bookedHoursAgo: 90, courierStatus: "partial_delivered" })).id)).toEqual(["deliveredButCourierPartial"]);
    expect(await exceptionsOf((await orderWith({ status: "DELIVERED", bookedHoursAgo: 90, courierStatus: "cancelled" })).id)).toEqual(["deliveredButCourierCancelled"]);
    expect(await exceptionsOf((await orderWith({ status: "DELIVERED", bookedHoursAgo: 90, courierStatus: null })).id)).toEqual(["deliveredWithoutCourierStatus"]);
    // Delivered by hand (never booked) is not a conflict.
    expect(await exceptionsOf((await orderWith({ status: "DELIVERED" })).id)).toEqual([]);
    expect(await exceptionsOf((await orderWith({ status: "DELIVERED", bookedHoursAgo: 90, courierStatus: "delivered" })).id)).toEqual([]);
  });

  it("leaves Trash out and changes nothing while reading", async () => {
    const o = await orderWith({ status: "SHIPPED", bookedHoursAgo: 1, courierStatus: "hold" });
    const stock = await stockOf(o.items[0]!.variantId);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    await getOrderExceptionsBoard();
    expect(await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).toEqual(before);
    expect(await stockOf(o.items[0]!.variantId)).toBe(stock);
    await prisma.order.update({ where: { id: o.id }, data: { deletedAt: new Date() } });
    expect(await inException("courierOnHold", o.id)).toBe(false);
  });
});

describe("counts equal the list", () => {
  it("every exception's count is what the orders list shows for ?exception=", async () => {
    await orderWith({ status: "SHIPPED", bookedHoursAgo: 1, courierStatus: "hold" });
    await orderWith({ status: "CANCELLED", bookedHoursAgo: 5, courierStatus: "pending" });
    const board = await getOrderExceptionsBoard();
    for (const id of ORDER_EXCEPTION_IDS) {
      const list = await listOrders({ exception: id, page: 1, pageSize: 25 } as never);
      expect(list.total, id).toBe(board.exceptions[id].count);
    }
    expect(board.exceptions.courierOnHold.count).toBeGreaterThan(0);
    expect(board.exceptions.courierOnHold.oldestAt).not.toBeNull();
  });

  it("is served at GET /api/orders/exceptions and the list accepts ?exception=", async () => {
    const o = await orderWith({ status: "SHIPPED", bookedHoursAgo: 1, courierStatus: "unknown" });
    const api = await asOwner();
    const board = await api.get("/api/orders/exceptions");
    expect(board.status).toBe(200);
    expect(board.body.exceptions.courierUnknown.count).toBeGreaterThan(0);
    const list = await api.get(`/api/orders?exception=courierUnknown&search=${o.orderNumber}`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([o.id]);
    expect((await api.get("/api/orders?exception=notAThing")).status).toBe(400);
  });
});

describe("the per-order parcel view agrees with the server", () => {
  it("names the stage, its age and the next action from the same facts", async () => {
    const view = (o: Awaited<ReturnType<typeof orderWith>>) =>
      describeParcel({ ...o, unitsExpectedBack: o.items.reduce((n, i) => n + Math.max(0, (o.status === "CANCELLED" ? i.quantity : i.returnedQuantity) - i.restockedQuantity), 0) });
    const late = view(await orderWith({ status: "SHIPPED", bookedHoursAgo: 30, courierStatus: "pending" }));
    expect(late).toMatchObject({ stage: "BOOKED_WITH_US", overdue: true, priority: 3 });
    expect(late.nextAction).toMatch(/scan it out/);
    expect(view(await orderWith({ status: "SHIPPED", bookedHoursAgo: 30, courierStatus: "pending", handedOver: true }))).toMatchObject({ stage: "WITH_COURIER", priority: 0 });
    expect(view(await orderWith({ status: "SHIPPED", bookedHoursAgo: 3, courierStatus: "hold" }))).toMatchObject({ stage: "ON_HOLD", priority: 3 });
    expect(view(await orderWith({ status: "CANCELLED", bookedHoursAgo: 5, courierStatus: "pending" }))).toMatchObject({ stage: "CANCEL_IN_COURIER_PANEL" });
    expect(view(await orderWith({ status: "PACKED", bookedHoursAgo: 2, courierStatus: "delivered" })).conflicts).toEqual(["BOOKED_BUT_PACKED"]);
    expect(view(await orderWith({ status: "DELIVERED", bookedHoursAgo: 90, courierStatus: "partial_delivered" })).conflicts).toEqual(["DELIVERED_BUT_COURIER_PARTIAL"]);
  });
});
