import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { checkout, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createOrder, updateOrderStatus } from "./order.service";
import { recordItemReturn } from "./order-adjustments.service";

// FINANCE_PHASE_4 §9.8: the SAME customer's checkout racing a store-credit item return deadlocked (lock-order inversion
// between the Customer row and the stock row). Every racing operation must succeed, round after round.

let admin: string;
let variantId: string;

async function deliver(orderId: string) {
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const) await updateOrderStatus(orderId, { status: s }, admin);
}
const order = async (quantity: number) => {
  const o = await createOrder(checkout([{ variantId, quantity }])); // one phone → one customer for every order
  trackOrder(o.id);
  return o;
};

beforeAll(async () => {
  admin = await ownerId();
  const p = await createStockedProduct({ stocks: [500], basePrice: 1000 });
  variantId = p.variants[0]!.id;
});
afterAll(async () => {
  await cleanupFixtures();
});

describe("one customer's checkout racing their own store-credit return", () => {
  it("never deadlocks and keeps stock exact", async () => {
    const failures: string[] = [];
    let expected = 500;
    for (let round = 0; round < 5; round++) {
      const first = await Promise.all(Array.from({ length: 4 }, () => order(2)));
      expected -= 8;
      for (const o of first) await deliver(o.id);
      const customerIds = new Set(first.map((o) => o.customerId));
      expect(customerIds.size).toBe(1); // really the same customer
      const lines = await Promise.all(first.map((o) => prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } })));
      const results = await Promise.allSettled([
        ...first.map((o, i) => recordItemReturn(o.id, { items: [{ orderItemId: lines[i]!.id, quantity: 1, restock: true }], reason: "size", compensation: "STORE_CREDIT" }, admin, `race-${o.id}`)),
        ...Array.from({ length: 4 }, () => order(1)),
      ]);
      for (const r of results) if (r.status === "rejected") failures.push(String((r.reason as Error)?.message ?? r.reason).slice(0, 160));
      // A recorded return changes no stock until its parcel is received (owner decision M2); only the new orders take stock.
      expected -= results.slice(4).filter((r) => r.status === "fulfilled").length;
    }
    expect(failures).toEqual([]);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock).toBe(expected);
  });
});
