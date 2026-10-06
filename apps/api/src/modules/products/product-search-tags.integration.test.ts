import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";

const RUN = Date.now();
const R = RUN.toString(36); // short, so a one-letter typo stays trigram-similar
const CSRF = "vitest-csrf";
let ownerId: string;
let staffId: string;
let categoryId: string;
let typeId: string;
let productId: string;
const synonymIds: string[] = [];

const TAG = `vtator${R}`;
// Shares no letter sequence with the tag or the name, so the typo fallback can't find the product through it by accident.
const SYNONYM = `qkw${String(RUN).slice(-6).replace(/\d/g, (d) => "bcfghjklmp"[Number(d)]!)}`;

function as(role: "OWNER" | "STAFF") {
  const cookie = [`access_token=${signAccessToken({ adminId: role === "OWNER" ? ownerId : staffId, role })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    put: (url: string, body: object) => auth(request(app).put(url)).send(body),
    delete: (url: string) => auth(request(app).delete(url)),
  };
}

async function searchIds(q: string): Promise<string[]> {
  const res = await request(app).get(`/api/products/storefront?search=${encodeURIComponent(q)}&sort=relevance`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.items as { id: string }[]).map((p) => p.id);
}

describe("search tags and store synonyms", () => {
  beforeAll(async () => {
    const [o, s, c] = await Promise.all([
      prisma.adminUser.create({ data: { name: "Vitest Owner", email: `vt_tags_owner_${RUN}@example.com`, passwordHash: "x", role: "OWNER" } }),
      prisma.adminUser.create({ data: { name: "Vitest Staff", email: `vt_tags_staff_${RUN}@example.com`, passwordHash: "x", role: "STAFF" } }),
      prisma.category.create({ data: { name: `Vitest Tags Cat ${RUN}`, slug: `vitest-tags-cat-${RUN}` } }),
    ]);
    ownerId = o.id;
    staffId = s.id;
    categoryId = c.id;
    const tpl = await prisma.productTemplate.create({ data: { name: `Tags template ${RUN}` } });
    const type = await prisma.productTypeDef.create({ data: { key: `tags-type-${RUN}`, name: `Tags type ${RUN}`, templateId: tpl.id, sortOrder: 9999 } });
    typeId = type.id;

    const res = await as("OWNER").post("/api/products", {
      name: `Vitest Oud ${RUN}`,
      categoryId,
      typeId,
      basePrice: 900,
      tags: [`#${TAG.toUpperCase()}`, TAG, "  "],
      variants: [{ sku: `VT-TAGS-${RUN}`, stock: 5 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    productId = res.body.product.id;
    // Publishing is gated on completeness (images etc.) that has nothing to do with search — go live directly.
    await prisma.product.update({ where: { id: productId }, data: { status: "PUBLISHED", isActive: true } });
  });

  afterAll(async () => {
    await prisma.searchSynonym.deleteMany({ where: { id: { in: synonymIds } } });
    await prisma.searchLog.deleteMany({ where: { query: { contains: R } } });
    await prisma.product.deleteMany({ where: { categoryId } });
    await prisma.productTypeDef.deleteMany({ where: { id: typeId } });
    await prisma.productTemplate.deleteMany({ where: { name: `Tags template ${RUN}` } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.stockMovement.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.auditLog.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });

  it("stores tags normalized and de-duplicated", async () => {
    const res = await as("OWNER").get(`/api/products/${productId}`);
    expect(res.body.product.tags).toEqual([TAG]);
  });

  it("a shopper's search finds the product by its tag, in any case", async () => {
    expect(await searchIds(TAG.toUpperCase())).toContain(productId);
    expect(await searchIds(`${TAG} perfume`)).toContain(productId);
  });

  it("a misspelled tag still finds it through the typo fallback", async () => {
    expect(await searchIds(`vtatorr${R}`)).toContain(productId);
  });

  it("tags aren't sent to the storefront", async () => {
    const res = await request(app).get(`/api/products/storefront?search=${TAG}`);
    expect(res.body.items[0]).not.toHaveProperty("tags");
  });

  it("a store synonym group makes a word nobody tagged find the product, until it is deleted", async () => {
    expect(await searchIds(SYNONYM)).not.toContain(productId);

    expect((await as("STAFF").post("/api/catalog/search-synonyms", { terms: [SYNONYM, TAG] })).status).toBe(403);
    const created = await as("OWNER").post("/api/catalog/search-synonyms", { terms: [SYNONYM, `#${TAG}`] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.synonym.terms).toEqual([SYNONYM, TAG]);
    synonymIds.push(created.body.synonym.id);

    expect(await searchIds(SYNONYM)).toContain(productId);

    const preview = await as("STAFF").get(`/api/catalog/search-synonyms/preview?q=${SYNONYM}`);
    expect(preview.status).toBe(200);
    expect(preview.body.terms).toEqual(expect.arrayContaining([SYNONYM, TAG]));
    expect(preview.body.products.map((p: { id: string }) => p.id)).toContain(productId);

    const off = await as("OWNER").put(`/api/catalog/search-synonyms/${created.body.synonym.id}`, { terms: [SYNONYM, TAG], isActive: false });
    expect(off.status).toBe(200);
    expect(await searchIds(SYNONYM)).not.toContain(productId);

    expect((await as("OWNER").delete(`/api/catalog/search-synonyms/${created.body.synonym.id}`)).status).toBe(204);
    const list = await as("OWNER").get("/api/catalog/search-synonyms");
    expect(list.body.synonyms.map((s: { id: string }) => s.id)).not.toContain(created.body.synonym.id);
    expect(list.body.builtIn.length).toBeGreaterThan(0);
  });

  it("refuses a group with fewer than two different words", async () => {
    const res = await as("OWNER").post("/api/catalog/search-synonyms", { terms: [TAG, TAG.toUpperCase()] });
    expect(res.status).toBe(400);
  });
});
