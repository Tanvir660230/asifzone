import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { RUN, asOwner, cleanupFixtures, createStockedProduct, placeOrder, stockOf } from "../../test-fixtures";
import { updateOrderStatus } from "../../modules/orders/order.service";
import { deleteProduct, restoreProduct } from "../../modules/products/product.service";
import { ensureFreshReadModels, findStaleProductIds, readModelDrift, rebuildAllReadModels, refreshReadModels } from "./read-model.service";
import { ownerId } from "../../test-fixtures";
import { cacheDelByPrefix } from "../../config/redis";

// Phase 3 — Storefront Read Model (docs/STOREFRONT_READ_MODEL.md): one canonical storefront product DTO, and a
// ProductReadModel projection of the canonical selling price that price sort/filter/recommendations read.

const made = { categoryIds: [] as string[], flashSaleIds: [] as string[] };
let admin: string;
let seq = 0;

async function category() {
  const n = ++seq;
  const c = await prisma.category.create({ data: { name: `VT P3 ${RUN} ${n}`, slug: `vt-p3-${RUN}-${n}` } });
  made.categoryIds.push(c.id);
  return c;
}

/** A published product in `categoryId`: basePrice and optional per-variant prices / stock / tracking. */
async function product(categoryId: string, basePrice: number, opts: { variantPrices?: Array<number | null>; stocks?: number[]; trackInventory?: boolean; lowStockThreshold?: number } = {}) {
  const { product: p, variants } = await createStockedProduct({ basePrice, stocks: opts.stocks ?? opts.variantPrices?.map(() => 10) ?? [10], variantPrices: opts.variantPrices });
  await prisma.product.update({ where: { id: p.id }, data: { categoryId, ...(opts.trackInventory === false ? { trackInventory: false } : {}), ...(opts.lowStockThreshold !== undefined ? { lowStockThreshold: opts.lowStockThreshold } : {}) } });
  return { id: p.id, slug: p.slug, variants };
}

async function flashSale(productId: string, over: { discountValue?: number; stockLimit?: number | null; startsInMin?: number; endsInMin?: number; enabled?: boolean } = {}) {
  const sale = await prisma.flashSale.create({
    data: {
      name: `VT P3 Flash ${RUN} ${made.flashSaleIds.length}`,
      startsAt: new Date(Date.now() + (over.startsInMin ?? -1) * 60_000),
      endsAt: new Date(Date.now() + (over.endsInMin ?? 60) * 60_000),
      enabled: over.enabled ?? true,
      isActive: (over.enabled ?? true) && (over.startsInMin ?? -1) <= 0,
      items: { create: { productId, discountType: "PERCENTAGE", discountValue: over.discountValue ?? 50, stockLimit: over.stockLimit ?? null } },
    },
    include: { items: true },
  });
  made.flashSaleIds.push(sale.id);
  return sale;
}

const listing = async (slug: string, query: Record<string, string> = {}) => {
  const res = await request(app).get("/api/products/storefront").query({ category: slug, pageSize: "50", ...query });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.items as Array<{
    id: string;
    pricing: { from: number };
    availability: { state: string; inStock: boolean; sellableUnits: number | null; variants: Record<string, { state: string }> };
  }>;
};
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const row = (productId: string) => prisma.productReadModel.findUnique({ where: { productId } });

beforeAll(async () => {
  admin = await ownerId();
});

afterAll(async () => {
  await prisma.flashSale.deleteMany({ where: { id: { in: made.flashSaleIds } } });
  await cleanupFixtures();
  await prisma.category.deleteMany({ where: { id: { in: made.categoryIds } } });
  await prisma.$disconnect();
});

describe("price sort, filter and facets use the canonical selling price (never basePrice)", () => {
  it("sorts and filters by the flash / variant selling price; facets bound the same value", async () => {
    const c = await category();
    const flashed = await product(c.id, 1000); // 50% flash → 500
    const plain = await product(c.id, 700); // 700
    const variantPriced = await product(c.id, 300, { variantPrices: [900] }); // base 300, sells at 900
    await flashSale(flashed.id);

    expect(ids(await listing(c.slug, { sort: "price_asc" }))).toEqual([flashed.id, plain.id, variantPriced.id]); // base order would be 300, 700, 1000
    expect(ids(await listing(c.slug, { sort: "price_desc" }))).toEqual([variantPriced.id, plain.id, flashed.id]);
    expect(ids(await listing(c.slug, { sort: "price_asc", minPrice: "600", maxPrice: "800" }))).toEqual([plain.id]);
    expect(ids(await listing(c.slug, { sort: "price_asc", maxPrice: "600" }))).toEqual([flashed.id]); // base 1000 would miss it
    expect(ids(await listing(c.slug, { sort: "price_asc", minPrice: "850" }))).toEqual([variantPriced.id]); // base 300 would miss it

    const facets = (await request(app).get("/api/products/storefront/facets").query({ category: c.slug })).body;
    expect([facets.minPrice, facets.maxPrice]).toEqual([500, 900]);

    // The projection equals what the cards show (the live canonical price).
    for (const item of await listing(c.slug)) expect(Number((await row(item.id))!.minSellingPrice)).toBe(item.pricing.from);
    expect((await row(flashed.id))!.hasLiveFlashSale).toBe(true);
  });

  it("inactive variants are excluded from the selling price", async () => {
    const c = await category();
    const p = await product(c.id, 1000, { variantPrices: [200, 800] });
    const cheap = p.variants.find((v) => Number(v.price) === 200)!;
    await prisma.productVariant.update({ where: { id: cheap.id }, data: { isActive: false } });
    expect(ids(await listing(c.slug, { maxPrice: "500" }))).toEqual([]);
    expect((await listing(c.slug))[0]!.pricing.from).toBe(800);
    expect(Number((await row(p.id))!.minSellingPrice)).toBe(800);
  });
});

describe("projection freshness: every input change is picked up before the projection is read", () => {
  it("price change (even a write that bypasses the service hooks) → re-sorted", async () => {
    const c = await category();
    const a = await product(c.id, 400);
    const b = await product(c.id, 600);
    expect(ids(await listing(c.slug, { sort: "price_asc" }))).toEqual([a.id, b.id]);
    await prisma.productVariant.update({ where: { id: a.variants[0]!.id }, data: { price: 900 } }); // raw write, no hook
    expect(ids(await listing(c.slug, { sort: "price_asc" }))).toEqual([b.id, a.id]);
    await prisma.product.update({ where: { id: b.id }, data: { basePrice: 1000 } });
    expect(ids(await listing(c.slug, { sort: "price_asc" }))).toEqual([a.id, b.id]);
  });

  it("flash sale added, disabled, re-enabled, deleted, scheduled and expired", async () => {
    const c = await category();
    const p = await product(c.id, 1000);
    const q = await product(c.id, 800);
    const order = () => listing(c.slug, { sort: "price_asc" }).then(ids);
    expect(await order()).toEqual([q.id, p.id]);

    const sale = await flashSale(p.id); // added (no hook: raw create) → flashItemCount differs
    expect(await order()).toEqual([p.id, q.id]);
    await prisma.flashSale.update({ where: { id: sale.id }, data: { enabled: false } }); // disabled → updatedAt
    expect(await order()).toEqual([q.id, p.id]);
    await prisma.flashSale.update({ where: { id: sale.id }, data: { enabled: true } });
    expect(await order()).toEqual([p.id, q.id]);
    await prisma.flashSale.delete({ where: { id: sale.id } }); // deleted (cascade) → no timestamp left, count catches it
    expect(await order()).toEqual([q.id, p.id]);

    // Scheduled: not live now; the row carries the start as validUntil, so the guard recomputes once it passes.
    const later = await flashSale(p.id, { startsInMin: 30, endsInMin: 90 });
    expect(await order()).toEqual([q.id, p.id]);
    const r = (await row(p.id))!;
    expect(r.validUntil?.getTime()).toBe(later.startsAt.getTime());
    const inWindow = new Date(later.startsAt.getTime() + 60_000);
    expect(await findStaleProductIds(inWindow)).toContain(p.id);
    await ensureFreshReadModels(inWindow);
    expect(Number((await row(p.id))!.minSellingPrice)).toBe(500);
    // …and expires: 1 ms after endsAt the row is stale again and goes back to the list price.
    expect((await row(p.id))!.validUntil?.getTime()).toBe(later.endsAt.getTime() + 1);
    const afterEnd = new Date(later.endsAt.getTime() + 1);
    await ensureFreshReadModels(afterEnd);
    expect(Number((await row(p.id))!.minSellingPrice)).toBe(1000);
    await rebuildAllReadModels(); // back to the real clock
  });

  it("flash quantity limit (D4): the row is volatile, so exhaustion and release re-sort immediately", async () => {
    const c = await category();
    const p = await product(c.id, 1000, { stocks: [20] });
    const q = await product(c.id, 800);
    await flashSale(p.id, { stockLimit: 1 });
    expect(ids(await listing(c.slug, { sort: "price_asc" }))).toEqual([p.id, q.id]);
    expect((await row(p.id))!.volatile).toBe(true);

    const o = await placeOrder([{ variantId: p.variants[0]!.id, quantity: 1 }], { customerPhone: "01799900001" });
    expect(ids(await listing(c.slug, { sort: "price_asc" }))).toEqual([q.id, p.id]); // quota gone → list price 1000
    await updateOrderStatus(o.id, { status: "CANCELLED" }, admin);
    expect(ids(await listing(c.slug, { sort: "price_asc" }))).toEqual([p.id, q.id]); // released → 500 again
  });

  it("publish / unpublish / trash / restore: only visible products are listed, filtered or recommended", async () => {
    const c = await category();
    const a = await product(c.id, 500);
    const b = await product(c.id, 600);
    expect(ids(await listing(c.slug, { sort: "price_asc" }))).toEqual([a.id, b.id]);

    await deleteProduct(b.id); // trash
    expect(ids(await listing(c.slug, { sort: "price_asc", maxPrice: "1000" }))).toEqual([a.id]);
    expect(ids((await request(app).get(`/api/products/${a.id}/similar`)).body.items)).toEqual([]);
    await restoreProduct(b.id);
    await prisma.product.update({ where: { id: b.id }, data: { status: "PUBLISHED", isActive: true } });
    expect(ids(await listing(c.slug, { sort: "price_asc" }))).toEqual([a.id, b.id]);

    await prisma.product.update({ where: { id: a.id }, data: { status: "DRAFT", isActive: false } }); // unpublish
    expect(ids(await listing(c.slug, { sort: "price_asc" }))).toEqual([b.id]);
    expect(ids((await request(app).get(`/api/products/${b.id}/budget-alternatives`)).body.items)).toEqual([]);
  });
});

describe("recommendations by canonical selling price", () => {
  it("similar (proximity), budget (cheaper) and upgrade (pricier) use the selling price, not basePrice", async () => {
    const c = await category();
    const target = await product(c.id, 700);
    const flashed = await product(c.id, 1200); // flash 50% → 600: 100 from the target (base 1200 is 500 away)
    const variantPriced = await product(c.id, 300, { variantPrices: [900] }); // sells at 900: 200 away (base 300 is 400 away)
    await flashSale(flashed.id);

    const similar = (await request(app).get(`/api/products/${target.id}/similar`)).body.items;
    expect(ids(similar)).toEqual([flashed.id, variantPriced.id]);
    expect(ids((await request(app).get(`/api/products/${target.id}/budget-alternatives`)).body.items)).toEqual([flashed.id]); // base: [variantPriced]
    expect(ids((await request(app).get(`/api/products/${target.id}/upgrade-options`)).body.items)).toEqual([variantPriced.id]); // base: [flashed]
  });

  it("trending budget filter uses the canonical price", async () => {
    const c = await category();
    const p = await product(c.id, 1000, { stocks: [20] });
    await flashSale(p.id, { discountValue: 70 }); // sells at 300
    await placeOrder([{ variantId: p.variants[0]!.id, quantity: 1 }], { customerPhone: "01799900002" });
    await cacheDelByPrefix("products:trending"); // the trending pool is cached
    const items = (await request(app).get("/api/products/storefront/trending").query({ maxPrice: "400", limit: "20" })).body.items;
    expect(ids(items)).toContain(p.id); // base 1000 would be filtered out
  });
});

describe("availability comes from canonical inventory state; the read model never writes inventory", () => {
  it("UNLIMITED / OUT_OF_STOCK / LOW_STOCK / IN_STOCK, live on the PDP even behind its cache", async () => {
    const c = await category();
    const untracked = await product(c.id, 100, { stocks: [0], trackInventory: false });
    const out = await product(c.id, 200, { stocks: [0] });
    const low = await product(c.id, 300, { stocks: [3], lowStockThreshold: 5 });
    const plenty = await product(c.id, 400, { stocks: [50], lowStockThreshold: 5 });
    const byId = new Map((await listing(c.slug, { sort: "price_asc" })).map((i) => [i.id, i.availability]));
    expect(byId.get(untracked.id)).toMatchObject({ state: "UNLIMITED", inStock: true, sellableUnits: null });
    expect(byId.get(out.id)).toMatchObject({ state: "OUT_OF_STOCK", inStock: false, sellableUnits: 0 });
    // Low stock is a VARIANT state only; the product-level state stays IN_STOCK.
    expect(byId.get(low.id)).toMatchObject({ state: "IN_STOCK", inStock: true, sellableUnits: 3, variants: { [low.variants[0]!.id]: { state: "LOW_STOCK" } } });
    expect(byId.get(plenty.id)).toMatchObject({ state: "IN_STOCK", inStock: true, sellableUnits: 50 });

    // The PDP read is Redis-cached; its availability still follows the live stock.
    const pdp = async () => (await request(app).get(`/api/products/slug/${low.slug}`)).body.product;
    expect((await pdp()).availability.variants[low.variants[0]!.id].state).toBe("LOW_STOCK");
    await placeOrder([{ variantId: low.variants[0]!.id, quantity: 3 }], { customerPhone: "01799900003" });
    expect(await stockOf(low.variants[0]!.id)).toBe(0);
    const after = await pdp();
    expect([after.availability.state, after.availability.inStock, after.variants[0].stock]).toEqual(["OUT_OF_STOCK", false, 0]);
  });

  it("rebuilding the projection writes no stock and no ledger movement", async () => {
    const [stockBefore, movementsBefore] = await Promise.all([prisma.productVariant.aggregate({ _sum: { stock: true } }), prisma.stockMovement.count()]);
    await rebuildAllReadModels();
    await ensureFreshReadModels();
    const [stockAfter, movementsAfter] = await Promise.all([prisma.productVariant.aggregate({ _sum: { stock: true } }), prisma.stockMovement.count()]);
    expect([stockAfter._sum.stock, movementsAfter]).toEqual([stockBefore._sum.stock, movementsBefore]);
  });
});

describe("stale detection, rebuild and reconciliation", () => {
  it("a missing row is projected before use; a corrupted row the guard can't see is reported by drift and fixed by rebuild", async () => {
    const c = await category();
    const p = await product(c.id, 450);
    await ensureFreshReadModels();
    await prisma.productReadModel.delete({ where: { productId: p.id } });
    expect(await findStaleProductIds()).toContain(p.id);
    expect(ids(await listing(c.slug, { maxPrice: "500" }))).toEqual([p.id]); // guard re-projected it

    // Corrupt it in a way the guard can't detect (the input fingerprint still matches): only reconciliation can.
    await prisma.productReadModel.update({ where: { productId: p.id }, data: { minSellingPrice: 1 } });
    expect(await findStaleProductIds()).not.toContain(p.id);
    const owner = await asOwner();
    const drift = (await owner.get("/api/v1/storefront/read-model/drift")).body.drift as Array<{ productId: string; issue: string; stored: string; expected: string }>;
    expect(drift.filter((d) => d.productId === p.id)).toEqual([{ productId: p.id, issue: "minSellingPrice", stored: "1", expected: "450" }]);
    const rebuilt = await owner.post("/api/v1/storefront/read-model/rebuild");
    expect(rebuilt.status).toBe(200);
    expect((await readModelDrift()).filter((d) => d.productId === p.id)).toEqual([]);
    expect(Number((await row(p.id))!.minSellingPrice)).toBe(450);
  });

  it("refresh is deterministic and idempotent", async () => {
    const c = await category();
    const p = await product(c.id, 777, { variantPrices: [null, 650] });
    const now = new Date();
    await refreshReadModels([p.id], now);
    const first = await row(p.id);
    await refreshReadModels([p.id, p.id], now);
    expect(await row(p.id)).toEqual(first);
    expect([Number(first!.minSellingPrice), Number(first!.maxSellingPrice), first!.sourceHash]).toEqual([650, 777, expect.stringMatching(/^[0-9a-f]{32}$/)]);
  });
});

describe("one storefront product contract across endpoints", () => {
  it("listing, PDP, by-ids, similar and suggestions agree on pricing and availability", async () => {
    const c = await category();
    const p = await product(c.id, 1000, { variantPrices: [null, 1400], stocks: [4, 9] });
    const peer = await product(c.id, 1100);
    await flashSale(p.id, { discountValue: 25 });

    const fromListing = (await listing(c.slug)).find((i) => i.id === p.id)!;
    const fromPdp = (await request(app).get(`/api/products/slug/${p.slug}`)).body.product;
    const fromByIds = (await request(app).get("/api/products/storefront/by-ids").query({ ids: p.id })).body.items[0];
    const fromSimilar = (await request(app).get(`/api/products/${peer.id}/similar`)).body.items.find((i: { id: string }) => i.id === p.id);
    for (const view of [fromPdp, fromByIds, fromSimilar]) {
      expect(view.pricing).toEqual(fromListing.pricing);
      expect(view.availability).toEqual(fromListing.availability);
      expect(view.activeFlashSale.flashPrice).toBe(String(fromListing.pricing.from));
    }
    expect(fromListing.pricing.from).toBe(750);
    const suggestion = (await request(app).get("/api/products/storefront/suggest").query({ q: `Vitest P1 ${RUN}` })).body.products.find((s: { id: string }) => s.id === p.id);
    if (suggestion) expect(suggestion.price).toBe(750);
  });
});
