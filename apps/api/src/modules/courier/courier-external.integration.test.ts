import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Steadfast is never called: each test says which consignments this store's key can't read (HTTP 401, a parcel booked on
// someone else's account) and records every status check the code makes.
const courier = vi.hoisted(() => ({ calls: [] as string[], unauthorized: new Set<string>() }));
vi.mock("../../providers/courier/steadfast", () => ({
  createSteadfastConsignment: vi.fn(),
  createBulkSteadfastConsignments: vi.fn(),
  getSteadfastBalance: vi.fn(async () => 0),
  getSteadfastFraudCheck: vi.fn(async () => {
    throw new Error("no courier in tests");
  }),
  getSteadfastStatusByConsignmentId: vi.fn(async (cid: string) => {
    courier.calls.push(cid);
    if (courier.unauthorized.has(cid)) throw new Error("Steadfast status check failed: HTTP 401");
    return "in_review";
  }),
}));
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";
import { bulkSyncCourierStatuses, getOrderByIdWithAutoSync, refreshSteadfastStatus, syncPendingCourierStatuses } from "./courier.service";

let admin: string;
let seq = Math.floor(Date.now() / 1000) * 1000 + 300;
let restoreIntegrations: () => void = () => {};
beforeAll(async () => {
  admin = await ownerId();
  restoreIntegrations = overrideIntegrationsForTests({ STEADFAST_API_KEY: "key", STEADFAST_SECRET_KEY: "secret" });
});
beforeEach(() => {
  courier.calls.length = 0;
  courier.unauthorized.clear();
});
afterAll(async () => {
  restoreIntegrations();
  await cleanupFixtures();
  await prisma.$disconnect();
});

/** A shipped order booked with Steadfast, due for its next status check. */
async function booked(opts: { external?: boolean; syncError?: string } = {}) {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  const consignmentId = String(++seq);
  await prisma.order.update({ where: { id: order.id }, data: { courierConsignmentId: consignmentId } });
  for (const s of ["CONFIRMED", "SHIPPED"] as const) await updateOrderStatus(order.id, { status: s }, admin);
  await prisma.order.update({
    where: { id: order.id },
    data: {
      courierBookedAt: new Date(Date.now() - 86_400_000),
      courierStatus: "in_review",
      courierNextPollAt: null,
      courierExternal: opts.external ?? false,
      courierSyncError: opts.syncError ?? null,
    },
  });
  return { order, consignmentId };
}
const row = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });

describe("parcels booked on another courier account", () => {
  it("are marked from the orders list: no more polling, the sync error goes; unbooked orders are skipped", async () => {
    const theirs = await booked({ syncError: "Steadfast status check failed: HTTP 401" });
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 900 });
    const notBooked = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);

    const res = await (await asOwner()).post("/api/orders/bulk/courier/external", { ids: [theirs.order.id, notBooked.id], external: true });
    expect(res.status).toBe(200);
    expect(res.body.updated).toEqual([theirs.order.id]);
    expect(res.body.skipped).toEqual([{ orderId: notBooked.id, orderNumber: notBooked.orderNumber, reason: "Not booked with a courier" }]);

    const after = await row(theirs.order.id);
    expect(after.courierExternal).toBe(true);
    expect(after.courierSyncError).toBeNull();
    expect(after.courierConsignmentId).toBe(theirs.consignmentId);
  });

  it("are never checked by the sweep, so they can't stop it checking our own parcels", async () => {
    // Three of someone else's parcels first in the queue used to fail three times in a row and end the run as "Steadfast down".
    const external = [await booked({ external: true }), await booked({ external: true }), await booked({ external: true })];
    for (const e of external) courier.unauthorized.add(e.consignmentId);
    const ours = await booked();

    const result = await syncPendingCourierStatuses({ orderIds: [...external.map((e) => e.order.id), ours.order.id] });
    expect(result.courierDown).toBe(false);
    expect(courier.calls).toEqual([ours.consignmentId]);
    for (const e of external) expect((await row(e.order.id)).courierSyncError).toBeNull();
  });

  it("are not re-checked on demand: Sync says so instead of pinning a 401 on them", async () => {
    const theirs = await booked({ external: true });
    courier.unauthorized.add(theirs.consignmentId);

    await expect(refreshSteadfastStatus(theirs.order.id)).rejects.toThrow(/another courier account/);
    const bulk = await bulkSyncCourierStatuses([theirs.order.id]);
    expect(bulk.synced).toEqual([]);
    expect(bulk.failed).toEqual([{ orderId: theirs.order.id, orderNumber: theirs.order.orderNumber, reason: expect.stringMatching(/another courier account/) }]);
    // Opening the order doesn't auto-sync it either.
    await prisma.order.update({ where: { id: theirs.order.id }, data: { courierStatusSyncedAt: new Date(Date.now() - 86_400_000) } });
    await getOrderByIdWithAutoSync(theirs.order.id);
    expect(courier.calls).toEqual([]);
    expect((await row(theirs.order.id)).courierSyncError).toBeNull();
  });

  it("can be put back on our account: due for a check straight away", async () => {
    const parcel = await booked({ external: true });
    await prisma.order.update({ where: { id: parcel.order.id }, data: { courierNextPollAt: new Date(Date.now() + 86_400_000) } });

    const res = await (await asOwner()).post("/api/orders/bulk/courier/external", { ids: [parcel.order.id], external: false });
    expect(res.status).toBe(200);
    expect(res.body.updated).toEqual([parcel.order.id]);
    const after = await row(parcel.order.id);
    expect(after.courierExternal).toBe(false);
    expect(after.courierNextPollAt).toBeNull();

    await syncPendingCourierStatuses({ orderIds: [parcel.order.id] });
    expect(courier.calls).toEqual([parcel.consignmentId]);
  });

  it("rejects an empty or oversized selection", async () => {
    const owner = await asOwner();
    expect((await owner.post("/api/orders/bulk/courier/external", { ids: [], external: true })).status).toBe(400);
    expect((await owner.post("/api/orders/bulk/courier/external", { ids: ["x"] })).status).toBe(400);
  });
});
