import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, placeOrder, stockOf } from "../../test-fixtures";

// Grouping separate products into one parent (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §1): variants move with their
// ids, SKUs and stock; what they inherited is pinned so nothing sells at a new price; Undo puts every change back.

const redirectPaths: string[] = [];

afterAll(async () => {
  await prisma.redirect.deleteMany({ where: { fromPath: { in: redirectPaths } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

const pdp = async (slug: string) => (await request(app).get(`/api/products/slug/${slug}`)).body.product as { variants: { id: string; color: string; size: string }[] } | undefined;

describe("product grouping", () => {
  it("refuses a grouping that would give two variants the same size and colour, and explains it", async () => {
    const parent = await createStockedProduct({ stocks: [2, 2] });
    const source = await createStockedProduct({ stocks: [1, 1] });
    const owner = await asOwner();
    const res = await owner.post("/api/products/groupings/preview", { parentId: parent.product.id, sources: [{ productId: source.product.id }] }).expect(200);
    expect(res.body.plan.blockers.join(" ")).toMatch(/Two variants would both be M \/ Black/);
    await owner.post("/api/products/groupings", { parentId: parent.product.id, sources: [{ productId: source.product.id }] }).expect(400);
    expect((await prisma.productVariant.findFirstOrThrow({ where: { id: source.variants[0]!.id } })).productId).toBe(source.product.id);
  });

  it("moves variants with their ids, SKUs and stock, keeps their price, redirects the old page, and undoes exactly", async () => {
    const parent = await createStockedProduct({ stocks: [5, 6], basePrice: 500 });
    const source = await createStockedProduct({ stocks: [3, 4], basePrice: 650 });
    await prisma.productImage.create({ data: { productId: source.product.id, url: "https://example.com/navy.jpg", sortOrder: 0 } });
    redirectPaths.push(`/product/${source.product.slug}`, `/lp/${source.product.slug}`);
    const owner = await asOwner();
    const body = { parentId: parent.product.id, sources: [{ productId: source.product.id, color: "Navy", colorHex: "#1f2a44" }], sizeRenames: { L: "L" } };

    const preview = (await owner.post("/api/products/groupings/preview", body).expect(200)).body.plan;
    expect(preview.blockers).toEqual([]);
    expect(preview.variants).toHaveLength(2);
    expect(preview.variants.every((v: { price: string }) => Number(v.price) === 650)).toBe(true);

    const { groupingId } = (await owner.post("/api/products/groupings", body).expect(201)).body;
    const moved = await prisma.productVariant.findMany({ where: { id: { in: source.variants.map((v) => v.id) } }, orderBy: { sku: "asc" } });
    expect(moved.every((v) => v.productId === parent.product.id && v.color === "Navy" && v.colorHex === "#1f2a44")).toBe(true);
    expect(moved.map((v) => v.sku)).toEqual(source.variants.map((v) => v.sku));
    expect(moved.every((v) => Number(v.price) === 650)).toBe(true);
    expect(await stockOf(source.variants[0]!.id)).toBe(3);

    // The colour's photo moved with it and is linked to its variants; the old product is off the shop and redirects.
    const img = await prisma.productImage.findFirstOrThrow({ where: { url: "https://example.com/navy.jpg", productId: parent.product.id } });
    expect(await prisma.variantImage.count({ where: { imageId: img.id } })).toBe(2);
    const old = await prisma.product.findUniqueOrThrow({ where: { id: source.product.id } });
    expect(old.status).toBe("UNPUBLISHED");
    expect((await prisma.redirect.findUniqueOrThrow({ where: { fromPath: `/product/${source.product.slug}` } })).toPath).toBe(`/product/${parent.product.slug}`);
    expect((await pdp(parent.product.slug))!.variants.map((v) => v.color).sort()).toEqual(["Black", "Black", "Navy", "Navy"]);

    // Selling a moved variant: the server prices it at its own pinned price and takes it from its own stock.
    const q = (await request(app).post("/api/v1/checkout/quote").send({ items: [{ variantId: moved[0]!.id, quantity: 1 }] }).expect(200)).body.quote;
    expect(q.subtotal).toBe(650);
    const order = await placeOrder([{ variantId: moved[0]!.id, quantity: 1 }]);
    expect(order.items[0]).toMatchObject({ variantId: moved[0]!.id, skuSnapshot: moved[0]!.sku, colorSnapshot: "Navy" });
    expect(await stockOf(moved[0]!.id)).toBe(moved[0]!.stock - 1);

    const list = (await owner.get(`/api/products/${parent.product.id}/groupings`).expect(200)).body.groupings;
    expect(list[0]).toMatchObject({ id: groupingId, variantCount: 2, undoneAt: null });

    await owner.post(`/api/products/groupings/${groupingId}/undo`).expect(204);
    const back = await prisma.productVariant.findMany({ where: { id: { in: source.variants.map((v) => v.id) } } });
    expect(back.every((v) => v.productId === source.product.id && v.color === "Black" && v.price === null && v.colorHex === null)).toBe(true);
    expect(await prisma.variantImage.count({ where: { imageId: img.id } })).toBe(0);
    expect((await prisma.productImage.findUniqueOrThrow({ where: { id: img.id } })).productId).toBe(source.product.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: source.product.id } })).status).toBe("PUBLISHED");
    expect(await prisma.redirect.count({ where: { fromPath: { in: redirectPaths } } })).toBe(0);
    // The sale made while grouped stays sold.
    expect(await stockOf(moved[0]!.id)).toBe(moved[0]!.stock - 1);
    await owner.post(`/api/products/groupings/${groupingId}/undo`).expect(409);
  });

  it("an unpublished product's variants arrive turned off, and size spellings can be mapped onto the parent's", async () => {
    const parent = await createStockedProduct({ stocks: [1, 1] });
    const source = await createStockedProduct({ stocks: [2], published: false });
    await prisma.productVariant.update({ where: { id: source.variants[0]!.id }, data: { size: "M 22" } });
    redirectPaths.push(`/product/${source.product.slug}`, `/lp/${source.product.slug}`);
    const owner = await asOwner();
    const res = await owner.post("/api/products/groupings", { parentId: parent.product.id, sources: [{ productId: source.product.id, color: "White" }], sizeRenames: { "M 22": "M" } }).expect(201);
    expect(res.body.plan.notes.join(" ")).toMatch(/arrive turned off/);
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: source.variants[0]!.id } });
    expect(v).toMatchObject({ productId: parent.product.id, size: "M", color: "White", isActive: false });
    await owner.post(`/api/products/groupings/${res.body.groupingId}/undo`).expect(204);
    expect(await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({ size: "M 22", isActive: true, productId: source.product.id });
  });

  it("refuses a source that still has its own campaign landing page", async () => {
    const parent = await createStockedProduct({ stocks: [1] });
    const source = await createStockedProduct({ stocks: [1] });
    const owner = await asOwner();
    await prisma.landingPage.create({ data: { name: "VT page", slug: `vt-group-${source.product.id}`, productId: source.product.id, content: {} } });
    const plan = (await owner.post("/api/products/groupings/preview", { parentId: parent.product.id, sources: [{ productId: source.product.id, color: "Red" }] }).expect(200)).body.plan;
    expect(plan.blockers.join(" ")).toMatch(/campaign landing pages/);
  });
});

describe("product grouping — no invented discounts", () => {
  it("a source without a “was” price doesn't inherit the parent's, so no false discount appears", async () => {
    const parent = await createStockedProduct({ stocks: [1], basePrice: 899 });
    await prisma.product.update({ where: { id: parent.product.id }, data: { compareAtPrice: 1760 } });
    const source = await createStockedProduct({ stocks: [1], basePrice: 750 });
    redirectPaths.push(`/product/${source.product.slug}`, `/lp/${source.product.slug}`);
    const owner = await asOwner();
    const { groupingId } = (await owner.post("/api/products/groupings", { parentId: parent.product.id, sources: [{ productId: source.product.id, color: "White" }] }).expect(201)).body;
    const shown = (await request(app).get(`/api/products/slug/${parent.product.slug}`).expect(200)).body.product;
    const white = shown.pricing.variants[source.variants[0]!.id];
    expect(Number(white.selling)).toBe(750);
    expect(white.compareAt === null || Number(white.compareAt) <= 750).toBe(true);
    await owner.post(`/api/products/groupings/${groupingId}/undo`).expect(204);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: source.variants[0]!.id } })).compareAtPrice).toBeNull();
  });
});
