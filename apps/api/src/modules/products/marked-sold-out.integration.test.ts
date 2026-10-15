import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, placeOrder, RUN } from "../../test-fixtures";

// "Show as sold out": the shop takes a whole product, or one variant (the 6ml while the 12ml sells), off sale while it
// still holds stock. Shoppers and checkout see no stock; the admin keeps the real count; turning it off sells again.

const made = { categoryIds: [] as string[] };

afterAll(async () => {
  await cleanupFixtures();
  await prisma.category.deleteMany({ where: { id: { in: made.categoryIds } } });
  await prisma.$disconnect();
});

const pdp = async (slug: string) => {
  const res = await request(app).get(`/api/products/slug/${slug}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.product as {
    variants: Array<{ id: string; stock: number }>;
    availability: { inStock: boolean; variants: Record<string, { sellable: boolean; state: string }> };
  };
};
const quote = (variantId: string) => request(app).post("/api/v1/checkout/quote").send({ items: [{ variantId, quantity: 1 }], shippingDistrict: "Dhaka" });

describe("show as sold out", () => {
  it("one variant: sold out to shoppers and at checkout, real stock kept for the admin, sells again when turned off", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [5, 7] });
    const [small, large] = variants;
    const owner = await asOwner();

    await owner.patch(`/api/products/${product.id}`, { variants: [{ id: small!.id, markedSoldOut: true }, { id: large!.id }] }).expect(200);

    const shown = await pdp(product.slug);
    expect(shown.variants.find((v) => v.id === small!.id)!.stock).toBe(0);
    expect(shown.availability.variants[small!.id]).toMatchObject({ sellable: false, state: "OUT_OF_STOCK" });
    expect(shown.availability.variants[large!.id]!.sellable).toBe(true);
    expect(shown.availability.inStock).toBe(true);

    const q = (await quote(small!.id)).body.quote;
    expect(q.warnings.some((w: { code: string; variantId: string }) => w.code === "INSUFFICIENT_STOCK" && w.variantId === small!.id)).toBe(true);
    await expect(placeOrder([{ variantId: small!.id, quantity: 1 }])).rejects.toThrow();

    // The real stock is untouched.
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: small!.id } })).stock).toBe(5);

    await owner.patch(`/api/products/${product.id}`, { variants: [{ id: small!.id, markedSoldOut: false }, { id: large!.id }] }).expect(200);
    const back = await pdp(product.slug);
    expect(back.variants.find((v) => v.id === small!.id)!.stock).toBe(5);
    expect(back.availability.variants[small!.id]!.sellable).toBe(true);
    const order = await placeOrder([{ variantId: small!.id, quantity: 1 }]);
    expect(order.items).toHaveLength(1);
  });

  it("the whole product: every variant sold out, and the category page doesn't count it in stock", async () => {
    const c = await prisma.category.create({ data: { name: `VT soldout ${RUN}`, slug: `vt-soldout-${RUN}` } });
    made.categoryIds.push(c.id);
    const { product, variants } = await createStockedProduct({ stocks: [3, 4] });
    await prisma.product.update({ where: { id: product.id }, data: { categoryId: c.id } });
    const owner = await asOwner();

    const stat = async () => (await request(app).get(`/api/categories/slug/${c.slug}/stock`)).body.total as { inStockProducts: number };
    expect((await stat()).inStockProducts).toBe(1);

    await owner.patch(`/api/products/${product.id}`, { markedSoldOut: true }).expect(200);
    const shown = await pdp(product.slug);
    expect(shown.availability.inStock).toBe(false);
    expect(variants.every((v) => shown.availability.variants[v.id]!.sellable === false)).toBe(true);
    expect((await stat()).inStockProducts).toBe(0);
    expect((await quote(variants[1]!.id)).body.quote.warnings[0].code).toBe("INSUFFICIENT_STOCK");
  });
  it("customers waiting for it are emailed when it goes back on sale, not while it is marked", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [3, 0] });
    const [, large] = variants;
    const owner = await asOwner();
    await owner.patch(`/api/products/${product.id}`, { variants: [{ id: variants[0]!.id }, { id: large!.id, markedSoldOut: true }] }).expect(200);
    const customer = await prisma.customer.create({ data: { name: "VT waiting", email: `vt-soldout-${RUN}@example.com` } });
    const alert = await prisma.stockAlert.create({ data: { customerId: customer.id, variantId: large!.id } });
    const notifiedAt = async () => (await prisma.stockAlert.findUniqueOrThrow({ where: { id: alert.id } })).notifiedAt;

    // A restock from zero would normally email them — not while it is marked sold out.
    await owner.patch(`/api/products/${product.id}`, { variants: [{ id: variants[0]!.id }, { id: large!.id, stock: 6, expectedStock: 0 }] }).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(await notifiedAt()).toBeNull();

    await owner.patch(`/api/products/${product.id}`, { variants: [{ id: variants[0]!.id }, { id: large!.id, markedSoldOut: false }] }).expect(200);
    await expect.poll(notifiedAt, { timeout: 3000 }).not.toBeNull();
    await prisma.customer.delete({ where: { id: customer.id } });
  });
});
