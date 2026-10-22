import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { getProductActions } from "./product-actions.service";

// "Now" is a fixed day long ago; orders fall in the 30 days before it.
const NOW = new Date("2009-03-31T12:00:00+06:00");
const day = (d: number) => new Date(`2009-03-${String(d).padStart(2, "0")}T12:00:00+06:00`);
let n = 0;
const ids: Record<string, string> = {};

async function sell(variantId: string, times: number) {
  const admin = await ownerId();
  for (let i = 0; i < times; i++) {
    const o = await createManualOrder(
      {
        items: [{ variantId, quantity: 1 }],
        customerName: "Vitest Actions",
        customerPhone: `0155${String(++n).padStart(7, "0")}`,
        shippingDivision: "Dhaka",
        shippingDistrict: "Dhaka",
        shippingArea: "Area",
        shippingAddressLine: "House 1",
        paymentMethod: "COD",
      } as never,
      admin,
    );
    trackOrder(o.id);
    await prisma.orderStatusHistory.updateMany({ where: { orderId: o.id }, data: { createdAt: day(2 + (i % 27)) } });
    await prisma.order.update({ where: { id: o.id }, data: { createdAt: day(2 + (i % 27)) } });
  }
}

beforeAll(async () => {
  const low = await createStockedProduct({ stocks: [50] });
  const out = await createStockedProduct({ stocks: [50] });
  const dead = await createStockedProduct({ stocks: [10] });
  ids.low = low.product.id;
  ids.out = out.product.id;
  ids.dead = dead.product.id;
  await sell(low.variants[0]!.id, 15); // 0.5 a day
  await sell(out.variants[0]!.id, 5);
  // Stock as it stands now: 2 left of the seller, none of the other, 10 of the one nobody orders.
  await prisma.productVariant.update({ where: { id: low.variants[0]!.id }, data: { stock: 2 } });
  await prisma.productVariant.update({ where: { id: out.variants[0]!.id }, data: { stock: 0 } });
  await prisma.productVariant.update({ where: { id: dead.variants[0]!.id }, data: { costPrice: 300 } });
}, 60_000);

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("product actions", () => {
  it("turns stock, selling speed and demand into what to do", async () => {
    const { actions } = await getProductActions(NOW);
    const mine = (pid: string) => actions.filter((a) => a.productId === pid).map((a) => [a.kind, a.priority, a.title, a.detail]);
    expect(mine(ids.low!)).toEqual([["restock", 2, expect.stringMatching(/^Restock .+ — about 4 days left$/), "2 left, selling about 0.5 a day"]]);
    expect(mine(ids.out!)).toEqual([["sold_out", 1, expect.stringMatching(/ is sold out$/), "Ordered 5 times in the last 30 days"]]);
    expect(mine(ids.dead!)).toEqual([["clear_stock", 3, "৳3,000 of stock not selling", "No orders in 60 days — discount it, bundle it or stop restocking"]]);
    // Most urgent first.
    const order = actions.map((a) => a.priority);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("is reachable over the API", async () => {
    const res = await (await asOwner()).get("/api/analytics/product-actions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("counts.restock");
  });
});
