import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";

const RUN = Date.now();
const R = RUN.toString(36);
// Two invented words: one names a product, the other only appears in another product's description.
const NAMED = `vtkurta${R}`;
const MENTIONED = `vtjubba${R}`;
const CATEGORY_WORD = `vtcaps${R}`;

let categoryId: string;
let namedId: string;
let mentionId: string;

async function createLiveProduct(data: { name: string; description: string; slug: string }) {
  const p = await prisma.product.create({
    data: {
      ...data,
      categoryId,
      basePrice: 650,
      status: "PUBLISHED",
      isActive: true,
      variants: { create: [{ sku: `VT-REL-${data.slug}`, stock: 4, size: "M", color: "Black" }] },
    },
  });
  return p.id;
}

describe("storefront search relevance", () => {
  beforeAll(async () => {
    const c = await prisma.category.create({ data: { name: `Vitest Prayer ${CATEGORY_WORD}`, slug: `vitest-rel-${RUN}` } });
    categoryId = c.id;
    namedId = await createLiveProduct({ name: `Vitest Classic ${NAMED}`, description: "Cotton, straight cut.", slug: `vt-rel-named-${RUN}` });
    // A cap whose care text mentions both words — a mention, not what the product is.
    mentionId = await createLiveProduct({
      name: `Vitest Woven Cap ${RUN}`,
      description: `A woven cap that pairs beautifully with ${NAMED} and ${MENTIONED}.`,
      slug: `vt-rel-mention-${RUN}`,
    });
  });

  afterAll(async () => {
    await prisma.searchLog.deleteMany({ where: { query: { contains: R } } });
    await prisma.product.deleteMany({ where: { categoryId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("leaves out products that only mention the word when some product is named by it", async () => {
    const res = await request(app).get(`/api/products/storefront?search=${NAMED}&sort=relevance`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.items as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(namedId);
    expect(ids).not.toContain(mentionId);
    expect(res.body.total).toBe(ids.length);
    expect(res.body.matchQuality).toBe("exact");
  });

  it("applies the same rule under every sort, and to the typeahead", async () => {
    const newest = await request(app).get(`/api/products/storefront?search=${NAMED}&sort=newest`);
    expect((newest.body.items as { id: string }[]).map((p) => p.id)).not.toContain(mentionId);

    const suggest = await request(app).get(`/api/products/storefront/suggest?q=${NAMED}`);
    const ids = (suggest.body.products as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(namedId);
    expect(ids).not.toContain(mentionId);
  });

  it("falls back to mentions, marked as related, when nothing is named by the word", async () => {
    const res = await request(app).get(`/api/products/storefront?search=${MENTIONED}&sort=relevance`);
    const ids = (res.body.items as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(mentionId);
    expect(res.body.matchQuality).toBe("related");

    const suggest = await request(app).get(`/api/products/storefront/suggest?q=${MENTIONED}`);
    expect((suggest.body.products as { id: string }[]).map((p) => p.id)).toContain(mentionId);
    expect(suggest.body.matchQuality).toBe("related");
  });

  it("suggests matching categories with their link", async () => {
    const res = await request(app).get(`/api/products/storefront/suggest?q=${CATEGORY_WORD}`);
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual([{ name: `Vitest Prayer ${CATEGORY_WORD}`, slug: `vitest-rel-${RUN}` }]);
    // The category is its own row, not repeated as a text prediction.
    expect(res.body.predictions).not.toContain(`Vitest Prayer ${CATEGORY_WORD}`);
  });

  it("doesn't repeat the products it shows as text predictions", async () => {
    const res = await request(app).get(`/api/products/storefront/suggest?q=${NAMED}`);
    const shown = (res.body.products as { name: string }[]).map((p) => p.name);
    expect(shown).toContain(`Vitest Classic ${NAMED}`);
    for (const name of shown) expect(res.body.predictions).not.toContain(name);
  });
});
