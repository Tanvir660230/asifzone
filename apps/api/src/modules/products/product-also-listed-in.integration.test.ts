import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";

const RUN = Date.now();
const CSRF = "vitest-csrf";
let ownerId: string;
let typeId: string;
let productId: string;
const cat: Record<"men" | "women" | "kids" | "womenSub", { id: string; slug: string }> = {} as never;

function owner() {
  const cookie = [`access_token=${signAccessToken({ adminId: ownerId, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body: object) => auth(request(app).post(url)).send(body),
    patch: (url: string, body: object) => auth(request(app).patch(url)).send(body),
  };
}

async function browseIds(slug: string): Promise<string[]> {
  const res = await request(app).get(`/api/products/storefront?category=${slug}&pageSize=50`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.items as { id: string }[]).map((p) => p.id);
}

describe('"Also show in" categories', () => {
  beforeAll(async () => {
    ownerId = (await prisma.adminUser.create({ data: { name: "Vitest Owner", email: `vt_also_${RUN}@example.com`, passwordHash: "x", role: "OWNER" } })).id;
    // Through the API, so the cached category tree (descendant lookups) is invalidated as in real use.
    const createCategory = async (name: string, parentId?: string) => {
      const res = await owner().post("/api/categories", { name, slug: name.toLowerCase().replace(/\s+/g, "-"), ...(parentId ? { parentId } : {}) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const c = res.body.category ?? res.body;
      return { id: c.id as string, slug: c.slug as string };
    };
    for (const key of ["men", "women", "kids"] as const) cat[key] = await createCategory(`VT also ${key} ${RUN}`);
    cat.womenSub = await createCategory(`VT also wsub ${RUN}`, cat.women.id);
    const tpl = await prisma.productTemplate.create({ data: { name: `Also template ${RUN}` } });
    typeId = (await prisma.productTypeDef.create({ data: { key: `also-type-${RUN}`, name: `Also type ${RUN}`, templateId: tpl.id, sortOrder: 9999 } })).id;

    const res = await owner().post("/api/products", {
      name: `Vitest Unisex ${RUN}`,
      categoryId: cat.men.id,
      // The home category and a duplicate are dropped, not stored twice.
      additionalCategoryIds: [cat.womenSub.id, cat.men.id, cat.womenSub.id],
      typeId,
      basePrice: 900,
      variants: [{ sku: `VT-ALSO-${RUN}`, stock: 5 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    productId = res.body.product.id;
    await prisma.product.update({ where: { id: productId }, data: { status: "PUBLISHED", isActive: true } });
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.productTypeDef.deleteMany({ where: { id: typeId } });
    await prisma.productTemplate.deleteMany({ where: { name: `Also template ${RUN}` } });
    await prisma.category.deleteMany({ where: { id: cat.womenSub.id } });
    await prisma.category.deleteMany({ where: { id: { in: [cat.men.id, cat.women.id, cat.kids.id] } } });
    await prisma.stockMovement.deleteMany({ where: { adminId: ownerId } });
    await prisma.auditLog.deleteMany({ where: { adminId: ownerId } });
    await prisma.adminUser.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it("stores the extra categories without the home one or duplicates", async () => {
    const res = await owner().get(`/api/products/${productId}`);
    expect(res.body.product.categoryId).toBe(cat.men.id);
    expect(res.body.product.additionalCategoryIds).toEqual([cat.womenSub.id]);
  });

  it("shows the product in its home category, the extra one, and the extra one's parent", async () => {
    expect(await browseIds(cat.men.slug)).toContain(productId);
    expect(await browseIds(cat.womenSub.slug)).toContain(productId);
    expect(await browseIds(cat.women.slug)).toContain(productId);
    expect(await browseIds(cat.kids.slug)).not.toContain(productId);
  });

  it("counts it in the extra category's stock summary and facets", async () => {
    const stock = await request(app).get(`/api/categories/slug/${cat.women.slug}/stock`);
    expect(stock.status).toBe(200);
    expect(stock.body.total.totalProducts).toBe(1);
    const facets = await request(app).get(`/api/products/storefront/facets?category=${cat.women.slug}`);
    expect(facets.status, JSON.stringify(facets.body)).toBe(200);
    expect(facets.body.priceRange?.max ?? facets.body.maxPrice).toBeDefined();
  });

  it("a save that leaves the list out keeps it; an empty list clears it", async () => {
    await owner().patch(`/api/products/${productId}`, { name: `Vitest Unisex ${RUN} renamed` }).expect(200);
    expect((await owner().get(`/api/products/${productId}`)).body.product.additionalCategoryIds).toEqual([cat.womenSub.id]);

    await owner().patch(`/api/products/${productId}`, { additionalCategoryIds: [] }).expect(200);
    expect((await owner().get(`/api/products/${productId}`)).body.product.additionalCategoryIds).toEqual([]);
    expect(await browseIds(cat.women.slug)).not.toContain(productId);
  });

  it("moving the home category onto an extra one drops it from the extras", async () => {
    await owner().patch(`/api/products/${productId}`, { additionalCategoryIds: [cat.women.id, cat.kids.id] }).expect(200);
    await owner().patch(`/api/products/${productId}`, { categoryId: cat.kids.id }).expect(200);
    const product = (await owner().get(`/api/products/${productId}`)).body.product;
    expect(product.categoryId).toBe(cat.kids.id);
    expect(product.additionalCategoryIds).toEqual([cat.women.id]);
    expect(await browseIds(cat.men.slug)).not.toContain(productId);
  });

  it("rejects an extra category that doesn't exist", async () => {
    const res = await owner().patch(`/api/products/${productId}`, { additionalCategoryIds: ["cjld2cjxh0000qzrmn831i7rn"] });
    expect(res.status).toBe(400);
  });
});
