import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { MAX_LINE_QUANTITY, PERMISSIONS, sellable } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN, stockOf } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { approvePurchaseOrder, createPurchaseOrder, submitPurchaseOrder } from "../finance/purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt } from "../finance/goods-receipts.service";
import { createSupplier } from "../finance/suppliers.service";
import { processFinancialEvent } from "../finance/events.service";
import { runReconciliation } from "../finance/reconciliation.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";
import { quickRefill } from "../manufacturing/quick-refill.service";
import { getProductBySlug } from "../../modules/products/product.service";
import { fillCapacity } from "./fill-capacity.service";
import { stockHub } from "./stock-hub.service";

// Inventory recovery phase 2 (2026-10-24): an attar on UNLIMITED never needs a stock "restock" to stay on sale — each sale
// still leaves stock (below zero = bottles owed) as a costed deficit, the fill takes the oil and bottles and covers it, and
// the books match. Caps and clothes can't be put on it. Expected values are literals worked out by hand.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
let supplierId = "";
let oil = "";
let bottle = "";
let dryOil = "";
let attar: { id: string; slug: string; variant: string };
let pre: { id: string; slug: string; variant: string };
let caps: { id: string; variant: string };

const as = (r: request.Test) => r.set("Cookie", [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);
const setPolicy = (productId: string, body: object) => as(request(app).put(`/api/v1/finance/stock/products/${productId}/policy`)).send({ reason: "owner decision", ...body });
const sells = async (variantId: string) => sellable(await stockOf(variantId), (await fillCapacity(prisma, { variantIds: [variantId] })).get(variantId) ?? 0);
const shown = async (slug: string) => (await getProductBySlug(slug))!.variants[0]!.stock;
const costState = (variantId: string) => prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId } });
let key = 0;
const refill = (variantId: string, quantity: number) => quickRefill({ variantId, quantity }, OWNER, `policy-refill-${RUN}-${++key}`);

async function buy(variantId: string, qty: number, unitPrice: number) {
  const po = await createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId, qtyOrdered: qty, unitPrice }] } as never, OWNER);
  await submitPurchaseOrder(po.id, OWNER);
  const approved = await approvePurchaseOrder(po.id, OWNER);
  const grn = await createGoodsReceipt({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: approved.lines[0]!.id, qtyAccepted: qty }] } as never, OWNER);
  await postGoodsReceipt(grn.id, {}, OWNER);
}
const material = async (name: string, unit: string) =>
  (await createMaterial({ name: `Vitest ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `POL-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
async function makeAttar(oilId: string) {
  const p = await createStockedProduct({ stocks: [0], basePrice: 350 });
  await prisma.product.update({ where: { id: p.product.id }, data: { fillToOrder: true } });
  const bom = await createBom({ productId: p.product.id, lines: [{ materialVariantId: oilId, qtyPerUnit: "6", wastagePct: "0" }, { materialVariantId: bottle, qtyPerUnit: "1", wastagePct: "0" }] } as never, OWNER);
  await approveBom(bom.id, OWNER);
  return { id: p.product.id, slug: p.product.slug, variant: p.variants[0]!.id };
}
async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [5], basePrice: 900 });
  caps = { id: seed.product.id, variant: seed.variants[0]!.id };
  await saveOpeningInventory([{ variantId: caps.variant, sku: "POL-CAP", name: "cap", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  supplierId = (await createSupplier({ legalName: "Vitest Policy Attar House" } as never, OWNER)).id;
  oil = await material("Policy oil", "ml");
  dryOil = await material("Policy dry oil", "ml");
  bottle = await material("Policy bottle", "pcs");
  await buy(oil, 60, 38); // 60 ml / 6 = 10 bottles can be made
  await buy(bottle, 100, 50);
  attar = await makeAttar(oil);
  pre = await makeAttar(dryOil); // its oil is not in stock: nothing can be made
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`UPDATE "OrderItem" SET "costMovementId" = NULL WHERE "costMovementId" IS NOT NULL`);
    await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "variantId" IN (SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.kind = 'MATERIAL' AND p.name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %'`);
  });
  await cleanupFixtures();
});

describe("TRACKED (the default): sells only what the materials make", () => {
  it("U-1: 0 filled, 10 makeable → an order of 11 is refused and nothing moves", async () => {
    expect((await prisma.product.findUniqueOrThrow({ where: { id: attar.id } })).stockPolicy).toBe("TRACKED");
    expect(await sells(attar.variant)).toBe(10);
    await expect(placeOrder([{ variantId: attar.variant, quantity: 11 }])).rejects.toMatchObject({ statusCode: 409 });
    expect(await stockOf(attar.variant)).toBe(0);
  });
});

describe("UNLIMITED: on sale without restocking, never free", () => {
  it("U-2: refused for a product that is not filled to order (caps stay tracked)", async () => {
    const r = await setPolicy(caps.id, { policy: "UNLIMITED" });
    expect(r.status).toBe(400);
    expect(r.body.details?.code).toBe("STOCK_POLICY_NEEDS_FILL");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: caps.id } })).stockPolicy).toBe("TRACKED");
  });

  it("U-3: set on the attar — the shop shows it in stock; changing the policy writes no stock and no movement", async () => {
    const moves = await prisma.stockMovement.count({ where: { variantId: attar.variant } });
    const r = await setPolicy(attar.id, { policy: "UNLIMITED" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await shown(attar.slug)).toBe(MAX_LINE_QUANTITY);
    expect(await stockOf(attar.variant)).toBe(0);
    expect(await prisma.stockMovement.count({ where: { variantId: attar.variant } })).toBe(moves);
  });

  it("U-4: two orders of 15 (30 > the 10 makeable) both go through with no restock: stock −30, a costed deficit of 30", async () => {
    await placeOrder([{ variantId: attar.variant, quantity: 15 }], { customerPhone: "01712000041" });
    await placeOrder([{ variantId: attar.variant, quantity: 15 }], { customerPhone: "01712000042" });
    expect(await stockOf(attar.variant)).toBe(-30);
    // every unit left stock through an ORDER movement — not an untracked, free sale
    const out = await prisma.stockMovement.aggregate({ where: { variantId: attar.variant, reason: "ORDER" }, _sum: { change: true } });
    expect(out._sum.change).toBe(-30);
    expect(await costState(attar.variant)).toMatchObject({ deficitQty: 30, unvaluedQty: 0, valuedQty: 0 });
    // the oil and bottles are untouched until the bottles are filled
    expect(await stockOf(oil)).toBe(60);
    expect(await stockOf(bottle)).toBe(100);
    expect(await sells(attar.variant)).toBeGreaterThanOrEqual(MAX_LINE_QUANTITY);
    await assertInventoryInvariants(attar.variant);
  });

  it("U-5: the stock hub shows the truth — 30 owed, what the materials alone can make (0: the owed bottles claim the oil)", async () => {
    const hub = await stockHub({ canSeeCost: true });
    const item = hub.groups.find((g) => g.key === "FILL_TO_ORDER")!.items.find((i) => i.variantId === attar.variant)!;
    expect(item.policy).toEqual({ policy: "UNLIMITED", overridden: false, backorderLimit: null, owed: 30 });
    expect(item.makeable).toBe(0);
  });

  it("U-6: filling 10 takes 60 ml and 10 bottles and covers 10 of the deficit; the books match", async () => {
    await refill(attar.variant, 10);
    expect(await stockOf(attar.variant)).toBe(-20);
    expect(await stockOf(oil)).toBe(0);
    expect(await stockOf(bottle)).toBe(90);
    expect(await costState(attar.variant)).toMatchObject({ deficitQty: 20 });
    const fill = await prisma.stockMovement.findFirstOrThrow({ where: { variantId: attar.variant, reason: "PRODUCTION_RECEIPT" }, orderBy: { createdAt: "desc" } });
    expect(fill.change).toBe(10);
    await postPending();
    const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity"] }, OWNER);
    expect(Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]))).toEqual({
      "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "ledger.integrity": "MATCHED",
    });
    await assertInventoryInvariants(attar.variant);
  });

  it("U-7: back to TRACKED stops new sales past capacity and rewrites nothing", async () => {
    const [stock, moves] = [await stockOf(attar.variant), await prisma.stockMovement.count({ where: { variantId: attar.variant } })];
    expect((await setPolicy(attar.id, { policy: "TRACKED" })).status).toBe(200);
    expect(await sells(attar.variant)).toBe(0); // no oil left, 20 owed
    await expect(placeOrder([{ variantId: attar.variant, quantity: 1 }])).rejects.toMatchObject({ statusCode: 409 });
    expect(await stockOf(attar.variant)).toBe(stock);
    expect(await prisma.stockMovement.count({ where: { variantId: attar.variant } })).toBe(moves);
  });
});

describe("BACKORDER and per-size overrides", () => {
  it("U-8: BACKORDER needs a limit", async () => {
    const r = await setPolicy(pre.id, { policy: "BACKORDER" });
    expect(r.status).toBe(400);
  });

  it("U-9: BACKORDER 5 with nothing makeable: 5 sell, the 6th is refused", async () => {
    expect(await sells(pre.variant)).toBe(0);
    expect((await setPolicy(pre.id, { policy: "BACKORDER", backorderLimit: 5 })).status).toBe(200);
    expect(await sells(pre.variant)).toBe(5);
    await placeOrder([{ variantId: pre.variant, quantity: 5 }], { customerPhone: "01712000043" });
    expect(await stockOf(pre.variant)).toBe(-5);
    await expect(placeOrder([{ variantId: pre.variant, quantity: 1 }])).rejects.toMatchObject({ statusCode: 409 });
    expect(await costState(pre.variant)).toMatchObject({ deficitQty: 5 });
  });

  it("U-10: a size can be UNLIMITED while its product is TRACKED", async () => {
    expect((await setPolicy(pre.id, { policy: "TRACKED", variants: [{ variantId: pre.variant, policy: "UNLIMITED" }] })).status).toBe(200);
    expect(await sells(pre.variant)).toBeGreaterThanOrEqual(MAX_LINE_QUANTITY);
    expect((await setPolicy(pre.id, { policy: "TRACKED", variants: [{ variantId: pre.variant, policy: null }] })).status).toBe(200);
    expect(await sells(pre.variant)).toBe(0);
  });
});
