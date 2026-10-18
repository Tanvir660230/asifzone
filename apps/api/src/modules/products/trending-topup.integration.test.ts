import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix } from "../../config/redis";
import { cleanupFixtures, createStockedProduct, placeOrder } from "../../test-fixtures";

// "Trending" ranks by recent sales. A new store has almost none, so the bag page's "Trending products" showed one lone
// card: the list is topped up — after the products that sold — with in-stock featured products, then the newest.

// A price band no other test's product sits in, so only this file's products can match the budget filter.
const BAND = { minPrice: "987600", maxPrice: "987699" };
const trending = async (limit = 8) => {
  await cacheDelByPrefix("products:trending");
  const res = await request(app).get("/api/products/storefront/trending").query({ ...BAND, limit: String(limit) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.items as Array<{ id: string }>).map((i) => i.id);
};

let sold: string, featured: string, older: string, newer: string, soldOutFeatured: string;

beforeAll(async () => {
  const make = async (price: number, stocks = [10]) => (await createStockedProduct({ basePrice: price, stocks })).product.id;
  older = await make(987_610);
  sold = await make(987_620, [20]);
  featured = await make(987_630);
  soldOutFeatured = await make(987_640, [0]);
  newer = await make(987_650);
  await prisma.product.updateMany({ where: { id: { in: [featured, soldOutFeatured] } }, data: { isFeatured: true } });
  // Distinct creation times: "newest" is a real order, not insertion luck.
  for (const [i, id] of [older, sold, featured, soldOutFeatured, newer].entries()) {
    await prisma.product.update({ where: { id }, data: { createdAt: new Date(Date.now() - (10 - i) * 60_000) } });
  }
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: sold } });
  await placeOrder([{ variantId: variant.id, quantity: 1 }], { customerPhone: "01799900071" });
});

afterAll(async () => {
  await cacheDelByPrefix("products:trending");
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("trending products with few sales", () => {
  it("lists what sold first, then in-stock featured products, then the newest — never a sold-out one", async () => {
    expect(await trending()).toEqual([sold, featured, newer, older]);
  });

  it("still stops at the limit", async () => {
    expect(await trending(2)).toEqual([sold, featured]);
  });
});
