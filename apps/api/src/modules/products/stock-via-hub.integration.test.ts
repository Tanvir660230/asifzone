import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import type { CreateProductInput, UpdateProductInput } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "../../domain/finance/finance-audit";
import { ensureCommerceAccounting } from "../../domain/finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../../domain/finance/purchasing-setup.service";
import { updateBusinessSettings } from "../../domain/finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../../domain/finance/opening-balances.service";
import { getFinanceContext } from "../../domain/finance/finance-context";
import { approveCutover, draftCutover, postCutover } from "../../domain/finance/inventory-cutover.service";
import { createProduct, updateProduct } from "./product.service";

// Stock hub Task 8 (docs/STOCK_HUB.md): once inventory costing is active, a tracked variant's stock changes only as
// Bought, Filled or Counted on the Stock page — the product form and the CSV import can't change it (409 STOCK_VIA_HUB).
// Before go-live nothing changes. Creating a product or a variant at stock 0 stays allowed.

const CSRF = "vitest-csrf";
let admin = "";
let OWNER: FinanceActor;
const patch = (id: string, body: object) => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  return request(app).patch(`/api/products/${id}`).set("Cookie", cookie).set("X-CSRF-Token", CSRF).send(body);
};
const stock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
const made: string[] = [];

let tracked: Awaited<ReturnType<typeof createStockedProduct>>;
let untracked: Awaited<ReturnType<typeof createStockedProduct>>;
let categoryId = "";

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const ctx = await getFinanceContext();
  const seed = (await createStockedProduct({ stocks: [1] })).variants[0]!;
  await saveOpeningInventory([{ variantId: seed.id, sku: seed.sku, name: "seed", quantity: 1, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  tracked = await createStockedProduct({ stocks: [5, 3] });
  untracked = await createStockedProduct({ stocks: [2] });
  await prisma.product.update({ where: { id: untracked.product.id }, data: { trackInventory: false } });
  categoryId = tracked.categoryId;
});

afterAll(async () => {
  if (made.length) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
      await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "variantId" IN (SELECT id FROM "ProductVariant" WHERE "productId" = ANY($1::text[]))`, made);
    });
  }
  await purgeFinanceTables();
  if (made.length) await prisma.product.deleteMany({ where: { id: { in: made } } });
  await cleanupFixtures();
});

const v0 = () => tracked.variants[0]!;
const v1 = () => tracked.variants[1]!;
const variantRow = (v: { id: string; sku: string; size: string; color: string }, stockValue: number, expectedStock: number) => ({ id: v.id, sku: v.sku, size: v.size, color: v.color, stock: stockValue, expectedStock });

describe("product form and CSV stock — before go-live", () => {
  it("allowed before go-live: a form edit and a CSV count change stock as before", async () => {
    const r = await patch(tracked.product.id, { variants: [variantRow(v0(), 7, 5), variantRow(v1(), 3, 3)] });
    expect(r.status, String(r.body.error)).toBe(200);
    expect(await stock(v0().id)).toBe(7);
    await updateProduct(tracked.product.id, { variants: [variantRow(v0(), 6, 7), variantRow(v1(), 3, 3)] } as UpdateProductInput, admin, undefined, { stockMode: "count" });
    expect(await stock(v0().id)).toBe(6);
  });

  it("a form edit or CSV count to below zero is refused (only fill to order goes negative, through sales)", async () => {
    const r = await patch(tracked.product.id, { variants: [variantRow(v0(), -1, 6), variantRow(v1(), 3, 3)] });
    expect(r.status, String(r.body.error)).toBe(400);
    await expect(
      updateProduct(tracked.product.id, { variants: [variantRow(v0(), -1, 6), variantRow(v1(), 3, 3)] } as UpdateProductInput, admin, undefined, { stockMode: "count" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await stock(v0().id)).toBe(6);
  });

  it("the admin can read the stock policy: not via the hub before go-live", async () => {
    const r = await request(app).get("/api/products/stock-policy").set("Cookie", [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`]);
    expect(r.status, String(r.body.error)).toBe(200);
    expect(r.body).toEqual({ stockViaHub: false });
  });
});

describe("product form and CSV stock — after go-live", () => {
  beforeAll(async () => {
    await draftCutover({}, OWNER);
    await approveCutover({ acknowledgeMissing: true }, OWNER);
    await postCutover(OWNER);
  });

  it("stock edit refused after go-live: 409 STOCK_VIA_HUB, nothing written", async () => {
    const before = await prisma.stockMovement.count({ where: { variantId: v0().id } });
    const r = await patch(tracked.product.id, { variants: [variantRow(v0(), 9, 6), variantRow(v1(), 3, 3)] });
    expect(r.status, String(r.body.error)).toBe(409);
    expect(r.body.details?.code).toBe("STOCK_VIA_HUB");
    expect(r.body.error).toMatch(/Bought, Filled or Counted on the Stock page/);
    expect(await stock(v0().id)).toBe(6);
    expect(await prisma.stockMovement.count({ where: { variantId: v0().id } })).toBe(before);
  });

  it("a save that doesn't change stock still goes through (stock sent unchanged, or a stale form)", async () => {
    const same = await patch(tracked.product.id, { basePrice: 610, variants: [variantRow(v0(), 6, 6), variantRow(v1(), 3, 3)] });
    expect(same.status, String(same.body.error)).toBe(200);
    const noStock = await patch(tracked.product.id, { basePrice: 620, variants: [{ id: v0().id, sku: v0().sku, size: v0().size, color: v0().color }, { id: v1().id, sku: v1().sku, size: v1().size, color: v1().color }] });
    expect(noStock.status, String(noStock.body.error)).toBe(200);
    expect(await stock(v0().id)).toBe(6);
  });

  it("CSV count refused after go-live", async () => {
    await expect(
      updateProduct(tracked.product.id, { variants: [variantRow(v0(), 2, 6), variantRow(v1(), 3, 3)] } as UpdateProductInput, admin, undefined, { stockMode: "count" }),
    ).rejects.toMatchObject({ statusCode: 409, details: { code: "STOCK_VIA_HUB" } });
    expect(await stock(v0().id)).toBe(6);
    // a CSV row that repeats today's stock changes nothing and passes
    await updateProduct(tracked.product.id, { variants: [variantRow(v0(), 6, 6), variantRow(v1(), 3, 3)] } as UpdateProductInput, admin, undefined, { stockMode: "count" });
  });

  it("new variant with stock 0 allowed after go-live; with opening stock refused", async () => {
    const keep = [variantRow(v0(), 6, 6), variantRow(v1(), 3, 3)];
    const refused = await patch(tracked.product.id, { variants: [...keep, { sku: `VT-HUB-NEW-${RUN}`, size: "XL", color: "Black", stock: 4 }] });
    expect(refused.status, String(refused.body.error)).toBe(409);
    expect(refused.body.details?.code).toBe("STOCK_VIA_HUB");
    expect(await prisma.productVariant.count({ where: { sku: `VT-HUB-NEW-${RUN}` } })).toBe(0);
    const ok = await patch(tracked.product.id, { variants: [...keep, { sku: `VT-HUB-NEW-${RUN}`, size: "XL", color: "Black", stock: 0 }] });
    expect(ok.status, String(ok.body.error)).toBe(200);
    expect(await stock((await prisma.productVariant.findUniqueOrThrow({ where: { sku: `VT-HUB-NEW-${RUN}` } })).id)).toBe(0);
  });

  it("a new product starts at 0 after go-live; opening stock on creation refused", async () => {
    const input = (sku: string, s: number) => ({ name: `Vitest Hub ${sku}`, categoryId, basePrice: 500, variants: [{ sku, size: "M", color: "Black", stock: s }] }) as unknown as CreateProductInput;
    await expect(createProduct(input(`VT-HUB-P1-${RUN}`, 5), admin)).rejects.toMatchObject({ statusCode: 409, details: { code: "STOCK_VIA_HUB" } });
    expect(await prisma.productVariant.count({ where: { sku: `VT-HUB-P1-${RUN}` } })).toBe(0);
    const p = await createProduct(input(`VT-HUB-P2-${RUN}`, 0), admin);
    made.push(p.id);
    expect(p.variants[0]!.stock).toBe(0);
  });

  it("the stock policy says stock moves via the hub after go-live", async () => {
    const r = await request(app).get("/api/products/stock-policy").set("Cookie", [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`]);
    expect(r.status, String(r.body.error)).toBe(200);
    expect(r.body).toEqual({ stockViaHub: true });
  });

  it("a fill-to-order product sold below zero (−2) still saves a price change, from the form and from a CSV", async () => {
    const attar = await createStockedProduct({ stocks: [0] });
    const v = attar.variants[0]!;
    await prisma.product.update({ where: { id: attar.product.id }, data: { fillToOrder: true } });
    await prisma.$executeRaw`UPDATE "ProductVariant" SET stock = -2 WHERE id = ${v.id}`;
    try {
      const r = await patch(attar.product.id, { basePrice: 777, variants: [variantRow(v, -2, -2)] });
      expect(r.status, String(r.body.error)).toBe(200);
      expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: attar.product.id } })).basePrice)).toBe(777);
      expect(await stock(v.id)).toBe(-2);
      await updateProduct(attar.product.id, { variants: [variantRow(v, -2, -2)] } as UpdateProductInput, admin, undefined, { stockMode: "count" });
      expect(await stock(v.id)).toBe(-2);
    } finally {
      await prisma.$executeRaw`UPDATE "ProductVariant" SET stock = 0 WHERE id = ${v.id}`;
    }
  });

  it("an untracked product's stock is not costed and stays editable", async () => {
    const u = untracked.variants[0]!;
    const r = await patch(untracked.product.id, { variants: [variantRow(u, 4, 2)] });
    expect(r.status, String(r.body.error)).toBe(200);
    expect(await stock(u.id)).toBe(4);
  });
});
