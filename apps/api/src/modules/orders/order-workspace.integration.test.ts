import { describe, it, expect, afterAll } from "vitest";
import { ORDER_QUEUE_FILTERS, ORDER_QUEUE_IDS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf } from "../../test-fixtures";
import { updateOrderStatus } from "./order.service";

// The Orders workspace's read side and bulk commands: queue counts, the courier-issue / refund-due queues, the admin
// detail's related records, and per-order outcomes for bulk trash / restore / permanent delete.

function queryOf(preset: Record<string, unknown>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(preset)) q.set(k, Array.isArray(v) ? v.join(",") : String(v));
  return q.toString();
}

afterAll(async () => {
  await cleanupFixtures();
});

describe("orders workspace — queues", () => {
  it("every queue badge in /stats equals the total its quick filter lists", async () => {
    const owner = await asOwner();
    const { variants } = await createStockedProduct({ stocks: [5] });
    await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);

    const stats = await owner.get("/api/orders/stats");
    expect(stats.status).toBe(200);
    expect(Object.keys(stats.body.queueCounts).sort()).toEqual([...ORDER_QUEUE_IDS].sort());
    expect(typeof stats.body.returnRequestsPending).toBe("number");

    for (const id of ORDER_QUEUE_IDS) {
      const list = await owner.get(`/api/orders?pageSize=1&${queryOf(ORDER_QUEUE_FILTERS[id])}`);
      expect(list.status, id).toBe(200);
      expect(list.body.total, id).toBe(stats.body.queueCounts[id]);
    }
  });

  it("courier issues: booked orders on courier hold or with a failed sync, combinable with search", async () => {
    const owner = await asOwner();
    const { variants } = await createStockedProduct({ stocks: [5] });
    const held = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    const stuck = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    const fine = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    const delivered = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    await updateOrderStatus(delivered.id, { status: "DELIVERED" }, await ownerId());
    await prisma.order.update({ where: { id: held.id }, data: { courierConsignmentId: `CI-${held.id}`, courierStatus: "hold" } });
    await prisma.order.update({ where: { id: stuck.id }, data: { courierConsignmentId: `CI-${stuck.id}`, courierStatus: "in_review", courierSyncError: "not found" } });
    await prisma.order.update({ where: { id: fine.id }, data: { courierConsignmentId: `CI-${fine.id}`, courierStatus: "in_review" } });
    // A stale sync error on a parcel that already reached the customer is history, not a delivery issue.
    await prisma.order.update({ where: { id: delivered.id }, data: { courierConsignmentId: `CI-${delivered.id}`, courierStatus: "unknown", courierSyncError: "old" } });

    const res = await owner.get("/api/orders?courierIssue=true&pageSize=100");
    const ids = res.body.items.map((o: { id: string }) => o.id);
    expect(ids).toEqual(expect.arrayContaining([held.id, stuck.id]));
    expect(ids).not.toContain(fine.id);
    expect(ids).not.toContain(delivered.id);

    // The search OR and the courier-issue OR must both apply (neither may overwrite the other).
    const searched = await owner.get(`/api/orders?courierIssue=true&search=${held.orderNumber}`);
    expect(searched.body.items.map((o: { id: string }) => o.id)).toEqual([held.id]);
  });

  it("refund due: a returned order that still holds the customer's money", async () => {
    const owner = await asOwner();
    const { variants } = await createStockedProduct({ stocks: [5] });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    const admin = await ownerId();
    await updateOrderStatus(order.id, { status: "DELIVERED" }, admin); // COD collected → PAID (D1)
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);

    const res = await owner.get("/api/orders?refundDue=true&pageSize=100");
    expect(res.body.items.map((o: { id: string }) => o.id)).toContain(order.id);
  });
});

describe("orders workspace — admin detail", () => {
  it("carries return requests, the courier-loss ledger, exchange origin and delivery score", async () => {
    const owner = await asOwner();
    const { variants } = await createStockedProduct({ stocks: [5] });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    // Booked, then cancelled: T6 logs a courier-loss row. A synced-just-now stamp keeps the detail from auto-syncing.
    await prisma.order.update({
      where: { id: order.id },
      data: { courierConsignmentId: `CL-${order.id}`, courierStatus: "delivered", courierStatusSyncedAt: new Date() },
    });
    await updateOrderStatus(order.id, { status: "CANCELLED" }, await ownerId());

    const res = await owner.get(`/api/orders/${order.id}`);
    expect(res.status).toBe(200);
    expect(res.body.order.courierLosses).toHaveLength(1);
    expect(res.body.order.courierLosses[0].reason).toBe("CANCELLED_POST_BOOKING");
    expect(res.body.order.returnRequests).toEqual([]);
    expect(res.body.order.exchangeOf).toBeNull();
    expect(res.body.order).toHaveProperty("deliveryScore");
    expect(res.body.order.payment).toBeTruthy();
  });
});

describe("orders workspace — bulk outcomes", () => {
  it("bulk restore reports each order: one restores, one is refused because its stock was sold meanwhile", async () => {
    const owner = await asOwner();
    const { variants } = await createStockedProduct({ stocks: [1, 3] });
    const scarce = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    const plenty = await placeOrder([{ variantId: variants[1]!.id, quantity: 1 }]);

    const trashed = await owner.post("/api/orders/bulk/delete", { ids: [scarce.id, plenty.id] });
    expect(trashed.status).toBe(200);
    expect(trashed.body.succeeded.sort()).toEqual([scarce.id, plenty.id].sort());
    expect(await stockOf(variants[0]!.id)).toBe(1);

    await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]); // the released unit sells again

    const restored = await owner.post("/api/orders/bulk/restore", { ids: [scarce.id, plenty.id] });
    expect(restored.status).toBe(200);
    expect(restored.body.succeeded).toEqual([plenty.id]);
    expect(restored.body.failed).toHaveLength(1);
    expect(restored.body.failed[0]).toMatchObject({ id: scarce.id, orderNumber: scarce.orderNumber });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: scarce.id } })).deletedAt).not.toBeNull();
  });

  it("bulk permanent delete only removes trashed orders and reports the rest", async () => {
    const owner = await asOwner();
    const { variants } = await createStockedProduct({ stocks: [3] });
    const inTrash = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    const active = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    await owner.post("/api/orders/bulk/delete", { ids: [inTrash.id] });

    const res = await owner.post("/api/orders/bulk/permanent", { ids: [inTrash.id, active.id] });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([inTrash.id]);
    expect(res.body.failed[0]).toMatchObject({ id: active.id, reason: "Move the order to Trash before deleting it permanently" });
    expect(await prisma.order.findUnique({ where: { id: inTrash.id } })).toBeNull();
    expect(await prisma.order.findUnique({ where: { id: active.id } })).not.toBeNull();
  });
});
