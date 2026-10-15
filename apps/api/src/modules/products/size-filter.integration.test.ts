import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { RUN, cleanupFixtures, createStockedProduct } from "../../test-fixtures";

// The storefront size filter: one chip per size whatever its spelling, in size order; a chip matches every spelling;
// and choosing a size AND a colour keeps both conditions (the colour used to overwrite the size).

const made = { categoryIds: [] as string[] };

async function productWith(categoryId: string, variants: Array<{ size: string; color: string }>) {
  const { product, variants: rows } = await createStockedProduct({ basePrice: 500, stocks: variants.map(() => 5) });
  await prisma.product.update({ where: { id: product.id }, data: { categoryId } });
  await Promise.all(rows.map((v, i) => prisma.productVariant.update({ where: { id: v.id }, data: { size: variants[i]!.size, color: variants[i]!.color } })));
  return product.id;
}

const listing = async (slug: string, query: Record<string, string>) => {
  const res = await request(app).get("/api/products/storefront").query({ category: slug, pageSize: "50", ...query });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.items as Array<{ id: string }>).map((p) => p.id).sort();
};

afterAll(async () => {
  await cleanupFixtures();
  await prisma.category.deleteMany({ where: { id: { in: made.categoryIds } } });
  await prisma.$disconnect();
});

describe("storefront size filter", () => {
  it("shows each size once, in size order, and a chip matches every spelling — combined with colour as AND", async () => {
    const c = await prisma.category.create({ data: { name: `VT sizes ${RUN}`, slug: `vt-sizes-${RUN}` } });
    made.categoryIds.push(c.id);
    const a = await productWith(c.id, [{ size: "M/22", color: "Black" }, { size: "L/22.5", color: "White" }]);
    const b = await productWith(c.id, [{ size: "M 22", color: "White" }]);
    const d = await productWith(c.id, [{ size: "L/22.5", color: "White" }, { size: "XS/21", color: "Black" }]);

    const facets = (await request(app).get("/api/products/storefront/facets").query({ category: c.slug })).body;
    expect(facets.sizes).toEqual(["XS/21", "M/22", "L/22.5"]);

    expect(await listing(c.slug, { sizes: "M/22" })).toEqual([a, b].sort());
    expect(await listing(c.slug, { sizes: "M/22", colors: "White" })).toEqual([a, b].sort());
    expect(await listing(c.slug, { sizes: "XS/21", colors: "White" })).toEqual([d]);
  });
});
