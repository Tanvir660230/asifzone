import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { permissionsForRole } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf } from "../../test-fixtures";
import { changeOrderStatus } from "../orders/order.service";
import { bulkReceiveParcels } from "./parcel-bulk-receive.service";

// Many returned parcels at once: each goes through the scanner's own receive; a parcel the customer may have kept
// something from, or with nothing to receive, is left for a person; the preview changes nothing; a retry receives
// nothing twice.

let owner: string;
let viewer: { adminId: string; permissions: ReturnType<typeof permissionsForRole> };
let seq = 0;

beforeAll(async () => {
  owner = await ownerId();
  viewer = { adminId: owner, permissions: permissionsForRole("OWNER") };
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function shipped(collected: number | null = null) {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: 500 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await changeOrderStatus(order.id, { status: "CONFIRMED", note: null }, owner);
  await prisma.order.update({ where: { id: order.id }, data: { courierConsignmentId: `8${Date.now().toString().slice(-8)}${seq++}`, courierBookedAt: new Date() } });
  await changeOrderStatus(order.id, { status: "PACKED", note: null }, owner);
  await changeOrderStatus(order.id, { status: "SHIPPED", note: null }, owner);
  if (collected !== null) await prisma.order.update({ where: { id: order.id }, data: { courierCollectedAmount: collected, courierCollectedAt: new Date() } });
  return { id: order.id, variantId: variants[0]!.id };
}

describe("bulk receive", () => {
  it("previews, receives the refused parcels in one go, leaves the rest for a person, and never receives twice", async () => {
    const refused = await shipped();
    const chargeOnly = await shipped(120); // the rider collected the delivery charge only
    const mayHaveKept = await shipped(500); // as much as the item: the customer may have kept it
    const delivered = await shipped();
    await changeOrderStatus(delivered.id, { status: "DELIVERED", note: null }, owner);
    const ids = [refused.id, chargeOnly.id, mayHaveKept.id, delivered.id];
    const before = await Promise.all([refused, chargeOnly].map((o) => stockOf(o.variantId)));

    const preview = await bulkReceiveParcels({ orderIds: ids, condition: "GOOD", dryRun: true }, viewer, "bulk:preview");
    expect(preview.rows.map((r) => r.action)).toEqual(["RECEIVE", "RECEIVE", "SKIP", "SKIP"]);
    expect(preview.rows[2]!.reason).toMatch(/may have kept/);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: refused.id } })).status).toBe("SHIPPED");

    const key = `bulk:t-${Date.now()}`;
    const done = await bulkReceiveParcels({ orderIds: ids, condition: "GOOD", dryRun: false }, viewer, key);
    expect(done.rows.map((r) => r.action)).toEqual(["RECEIVED", "RECEIVED", "SKIP", "SKIP"]);
    const after = await Promise.all([refused, chargeOnly].map((o) => stockOf(o.variantId)));
    expect(after).toEqual(before.map((n) => n + 1));
    for (const o of [refused, chargeOnly]) await assertInventoryInvariants(o.variantId);

    // A retried confirm: each parcel is already back, nothing moves again.
    const again = await bulkReceiveParcels({ orderIds: ids, condition: "GOOD", dryRun: false }, viewer, key);
    expect(again.rows.slice(0, 2).map((r) => r.action)).toEqual(["SKIP", "SKIP"]);
    expect(await Promise.all([refused, chargeOnly].map((o) => stockOf(o.variantId)))).toEqual(after);
    expect(await prisma.parcelReceipt.count({ where: { orderId: { in: [refused.id, chargeOnly.id] } } })).toBe(2);
  });
});
