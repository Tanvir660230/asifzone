import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial, listMaterials, materialNameKey, updateMaterial } from "../manufacturing/materials.service";
import { belowReorderPoint, suggestReorder } from "./stock-items.service";
import { stockUnitsOf } from "./purchase.service";

// docs/MATERIALS_PURCHASING.md: materials (type, duplicate names, purchase units kept as history) and the purchase form's
// purchase units converted on the server, units on the bill in bill units, discount, damaged on arrival and extras by quantity.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
const api = () => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return { post: (url: string, body: object, key: string) => auth(request(app).post(`/api/v1/finance${url}`)).set("Idempotency-Key", key).send(body) };
};
const SEE = { canSeeCost: true };
const stock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
const avg = async (id: string) => Number((await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: id } })).avgUnitCost);
const receiptLines = (receiptId: string) => prisma.goodsReceiptLine.findMany({ where: { goodsReceiptId: receiptId }, orderBy: { lineNo: "asc" } });

let bank = "";
const mat = async (name: string, unit: string, extra: object = {}) => {
  const m = await createMaterial({ name: `Vitest ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `MP-${name.replace(/\W/g, "")}-${RUN}`, spec: name }], ...extra }, OWNER, SEE);
  return { productId: m.id, variantId: m.variants[0]!.id };
};
const units = async (productId: string) => (await listMaterials({ q: undefined, includeArchived: true }, SEE)).materials.find((m) => m.id === productId)!.purchaseUnits;

let oil: { productId: string; variantId: string };
let sticker: { productId: string; variantId: string };
let bottle: { productId: string; variantId: string };
let musk: { productId: string; variantId: string };

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "MP-SEED", name: "seed", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  oil = await mat("Oil", "ml", { materialType: "RAW" });
  sticker = await mat("Sticker", "pcs", { materialType: "PACKAGING" });
  bottle = await mat("Bottle", "pcs", { materialType: "PACKAGING" });
  musk = await mat("Musk", "g", { materialType: "RAW" });
  await updateMaterial(oil.productId, { purchaseUnits: [{ label: "litre", factor: 1000 }] }, OWNER, SEE);
  await updateMaterial(sticker.productId, { purchaseUnits: [{ label: "bundle", factor: 200 }, { label: "sheet", factor: 100 }] }, OWNER, SEE);
  await updateMaterial(musk.productId, { purchaseUnits: [{ label: "tola", factor: 11.6638 }] }, OWNER, SEE);
  const r = await request(app).post("/api/v1/finance/financial-accounts")
    .set("Cookie", [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF)
    .send({ kind: "BANK", name: `Bank MP ${RUN}`, openingBalance: { amount: 500000, date: "2026-09-01" } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  bank = r.body.id;
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "variantId" IN (SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.kind = 'MATERIAL' AND p.name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "MaterialPurchaseUnit" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %'`);
  });
  await cleanupFixtures();
});

const paid = { financialAccountId: "" };
const buy = (body: object, key: string) => api().post("/stock/purchases", { paidFrom: { ...paid, financialAccountId: bank }, ...body }, `${key}-${RUN}`);

describe("conversion arithmetic", () => {
  it("is exact in ten-thousandths and refuses fractions of a stock unit", () => {
    expect(stockUnitsOf(2.5, 1000)).toBe(2500);
    expect(stockUnitsOf(0.1, 1000)).toBe(100);
    expect(stockUnitsOf(5, 200)).toBe(1000);
    expect(stockUnitsOf(1.5, 11.6638)).toBeNull();
    expect(stockUnitsOf(10, 11.6638)).toBeNull();
    expect(stockUnitsOf(10_000, 11.6638)).toBe(116_638);
  });
});

describe("materials", () => {
  it("a material's type is kept; the same name in other spacing or case is asked about, and allowed with a reason", async () => {
    expect((await listMaterials({}, SEE)).materials.find((m) => m.id === oil.productId)!.materialType).toBe("RAW");
    expect(materialNameKey("Attar  Sticker.")).toBe(materialNameKey("attar-sticker"));
    expect(materialNameKey("আতর স্টিকার")).toBe(materialNameKey("আতর-স্টিকার"));
    const twin = createMaterial({ name: `vitest   STICKER ${RUN}.`, stockUnit: "pcs", variants: [{ sku: `MP-TWIN-${RUN}`, spec: "x" }] }, OWNER, SEE);
    await expect(twin).rejects.toMatchObject({ statusCode: 409, details: { code: "MATERIAL_DUPLICATE", matches: [{ id: sticker.productId }] } });
    const made = await createMaterial({ name: `vitest   STICKER ${RUN}.`, stockUnit: "pcs", duplicateReason: "Round sticker, a different size", variants: [{ sku: `MP-TWIN-${RUN}`, spec: "x" }] }, OWNER, SEE);
    expect(made.id).not.toBe(sticker.productId);
    const audit = await prisma.financeAuditEntry.findFirst({ where: { entityId: made.id, action: "material.create" }, orderBy: { createdAt: "desc" } });
    expect(audit?.after).toMatchObject({ duplicateReason: "Round sticker, a different size", duplicateOf: [sticker.productId] });
  });

  it("the database keeps a material type off finished goods", async () => {
    const p = await createStockedProduct({ stocks: [0], basePrice: 100 });
    await expect(prisma.product.update({ where: { id: p.id }, data: { materialType: "RAW" } })).rejects.toThrow();
  });
});

describe("purchase units", () => {
  let oilReceipt = "";

  it("2.5 litre of oil is 2,500 ml in stock, and the receipt keeps what was bought", async () => {
    const litre = (await units(oil.productId)).find((u) => u.label === "litre")!;
    const r = await buy({ lines: [{ variantId: oil.variantId, purchaseUnitId: litre.id, purchaseQty: 2.5, amount: 50000 }], documentTotal: 2.5 }, "oil-litre");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    oilReceipt = r.body.receiptId;
    expect(await stock(oil.variantId)).toBe(2500);
    expect(await avg(oil.variantId)).toBe(20);
    const [line] = await receiptLines(oilReceipt);
    expect(line).toMatchObject({ qtyAccepted: 2500, purchaseUnitId: litre.id, purchaseUnitLabel: "litre" });
    expect(Number(line!.purchaseUnitFactor)).toBe(1000);
    expect(Number(line!.purchaseQty)).toBe(2.5);
    expect(r.body.purchase.lines[0]).toMatchObject({ quantity: 2500, buy: { label: "litre", factor: 1000, qty: 2.5 } });
  });

  it("1.5 tola of musk is not a whole number of grams: refused with the two whole amounts, nothing written", async () => {
    const tola = (await units(musk.productId))[0]!;
    const before = await prisma.goodsReceipt.count();
    const r = await buy({ lines: [{ variantId: musk.variantId, purchaseUnitId: tola.id, purchaseQty: 1.5, amount: 3000 }], documentTotal: 1.5 }, "musk-tola");
    expect(r.status).toBe(400);
    expect(r.body.details).toMatchObject({ code: "PURCHASE_UNIT_NOT_WHOLE", below: 17, above: 18 });
    expect(await prisma.goodsReceipt.count()).toBe(before);
    expect(await stock(musk.variantId)).toBe(0);
  });

  it("a unit of another item, or none given with no quantity, is refused", async () => {
    const bundle = (await units(sticker.productId)).find((u) => u.label === "bundle")!;
    const r = await buy({ lines: [{ variantId: oil.variantId, purchaseUnitId: bundle.id, purchaseQty: 1, amount: 100 }], documentTotal: 1 }, "wrong-unit");
    expect(r.status).toBe(400);
    expect(r.body.details?.code).toBe("PURCHASE_UNIT_NOT_FOUND");
    const none = await buy({ lines: [{ variantId: oil.variantId, amount: 100 }], documentTotal: 1 }, "no-qty");
    expect(none.status).toBe(400);
  });

  it("a used unit keeps its size: re-sizing is refused, leaving it out archives it, sending it again brings it back", async () => {
    await expect(updateMaterial(oil.productId, { purchaseUnits: [{ label: "litre", factor: 500 }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409, details: { code: "PURCHASE_UNIT_IN_USE" } });
    await updateMaterial(oil.productId, { purchaseUnits: [{ label: "can", factor: 5000 }] }, OWNER, SEE);
    expect((await units(oil.productId)).map((u) => u.label)).toEqual(["can"]);
    const litre = await prisma.materialPurchaseUnit.findFirstOrThrow({ where: { productId: oil.productId, label: "litre" } });
    expect(litre.archivedAt).not.toBeNull();
    expect((await receiptLines(oilReceipt))[0]!.purchaseUnitId).toBe(litre.id);
    // an archived unit can't be bought in
    const r = await buy({ lines: [{ variantId: oil.variantId, purchaseUnitId: litre.id, purchaseQty: 1, amount: 100 }], documentTotal: 1 }, "archived-unit");
    expect(r.body.details?.code).toBe("PURCHASE_UNIT_NOT_FOUND");
    await updateMaterial(oil.productId, { purchaseUnits: [{ label: "litre", factor: 1000 }] }, OWNER, SEE);
    expect((await units(oil.productId)).map((u) => u.label)).toEqual(["litre"]);
    expect(await prisma.materialPurchaseUnit.count({ where: { productId: oil.productId, label: "can" } })).toBe(0);
  });

  it("a material that has moved keeps its stock unit", async () => {
    await expect(updateMaterial(oil.productId, { stockUnit: "litre-x" }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409, details: { code: "MATERIAL_UNIT_IN_USE" } });
    // never moved: free to change
    await updateMaterial(musk.productId, { stockUnit: "mg" }, OWNER, SEE);
    await updateMaterial(musk.productId, { stockUnit: "g" }, OWNER, SEE);
  });
});

describe("bulk purchase", () => {
  it("bottles in pieces, stickers in bundles and oil in litres: one purchase, units on the bill counted as the bill shows them", async () => {
    const bundle = (await units(sticker.productId)).find((u) => u.label === "bundle")!;
    const litre = (await units(oil.productId)).find((u) => u.label === "litre")!;
    const before = { s: await stock(sticker.variantId), o: await stock(oil.variantId), b: await stock(bottle.variantId) };
    const lines = [
      { variantId: bottle.variantId, quantity: 1000, amount: 10000 },
      { variantId: sticker.variantId, purchaseUnitId: bundle.id, purchaseQty: 5, amount: 500 },
      { variantId: oil.variantId, purchaseUnitId: litre.id, purchaseQty: 10, amount: 200000 },
    ];
    const wrong = await buy({ lines, documentTotal: 11000 }, "bulk-wrong");
    expect(wrong.status).toBe(400);
    const r = await buy({ lines, documentTotal: 1015 }, "bulk");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await stock(bottle.variantId)).toBe(before.b + 1000);
    expect(await stock(sticker.variantId)).toBe(before.s + 1000);
    expect(await stock(oil.variantId)).toBe(before.o + 10000);
    expect(await prisma.goodsReceipt.count({ where: { id: r.body.receiptId } })).toBe(1);
  });
});

describe("discount, damaged on arrival and extras", () => {
  it("100 bottles, 4 broken, ৳40 off: 96 go into stock at the net ৳960; the receipt rejects 4 and keeps the discount", async () => {
    const before = await stock(bottle.variantId);
    const r = await buy({ lines: [{ variantId: bottle.variantId, quantity: 100, damaged: 4, discount: 40, amount: 960 }], documentTotal: 100 }, "bottles-damaged");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await stock(bottle.variantId)).toBe(before + 96);
    const lines = await receiptLines(r.body.receiptId);
    expect(lines.reduce((s, l) => s + l.qtyAccepted, 0)).toBe(96);
    expect(lines.reduce((s, l) => s + l.qtyRejected, 0)).toBe(4);
    expect(lines.reduce((s, l) => s + Number(l.value), 0)).toBe(960);
    expect(lines.reduce((s, l) => s + Number(l.discountAmount), 0)).toBe(40);
    expect(Number(lines[0]!.grossUnitPrice)).toBe(10);
    const bill = await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: r.body.invoiceId } });
    expect(Number(bill.total)).toBe(960);
  });

  it("all of a line damaged is refused", async () => {
    const r = await buy({ lines: [{ variantId: bottle.variantId, quantity: 10, damaged: 10, amount: 100 }], documentTotal: 10 }, "all-damaged");
    expect(r.status).toBe(400);
    expect(r.body.details?.code).toBe("PURCHASE_ALL_DAMAGED");
  });

  it("extras by quantity: ৳200 transport over 100 bottles and 100 ml gives each line ৳100, not ৳20 and ৳180", async () => {
    const lines = [{ variantId: bottle.variantId, quantity: 100, amount: 1000 }, { variantId: oil.variantId, quantity: 100, amount: 9000 }];
    const r = await buy({ lines, documentTotal: 200, extras: [{ description: "Transport", amount: 200 }], extrasMethod: "QUANTITY" }, "extras-qty");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const landed = await prisma.landedCost.findUniqueOrThrow({ where: { id: r.body.landedCostId } });
    expect(landed.method).toBe("QUANTITY");
    const parts = landed.allocations as Array<{ variantId: string; amount: number }>;
    expect(parts.find((p) => p.variantId === bottle.variantId)!.amount).toBe(100);
    expect(parts.find((p) => p.variantId === oil.variantId)!.amount).toBe(100);
  });
});

describe("reorder point", () => {
  it("at or below its own reorder point an item is LOW and to buy today, used lately or not", () => {
    expect(belowReorderPoint("OK", 50, 50)).toBe("LOW");
    expect(belowReorderPoint("OK", 51, 50)).toBe("OK");
    expect(belowReorderPoint("OUT", 0, 50)).toBe("OUT");
    expect(belowReorderPoint("OK", 10, null)).toBe("OK");
    expect(suggestReorder({ usedPerDay: null, available: 30, leadTimeDays: 3, coverDays: 30, today: "2026-11-02", reorderPoint: 50, safetyStock: 20 })).toEqual({ suggested: 40, orderBy: "2026-11-02" });
    expect(suggestReorder({ usedPerDay: null, available: 60, leadTimeDays: 3, coverDays: 30, today: "2026-11-02", reorderPoint: 50 })).toBeNull();
    // with use: lead time + cover + safety stock, ordered today once at the point
    expect(suggestReorder({ usedPerDay: 10, available: 50, leadTimeDays: 3, coverDays: 7, today: "2026-11-02", reorderPoint: 50, safetyStock: 10 })).toEqual({ suggested: 60, orderBy: "2026-11-02" });
    // nothing set: unchanged behaviour
    expect(suggestReorder({ usedPerDay: 10, available: 50, leadTimeDays: 3, coverDays: 7, today: "2026-11-02" })).toEqual({ suggested: 50, orderBy: "2026-11-04" });
  });
});
