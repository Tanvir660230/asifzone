import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { MAX_LINE_QUANTITY, PERMISSIONS, sellable } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, stockOf } from "../../test-fixtures";
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
import { getProductBySlug } from "../../modules/products/product.service";
import { fillCapacity } from "./fill-capacity.service";

// Bought to order (docs/superpowers/plans/2026-11-21-bought-to-order.md): Tahafi's jackets are fetched from the supplier
// after they sell. A stock-tracked READY product on UNLIMITED / BACKORDER keeps selling at zero — stock goes below zero
// (sold, not yet bought) as a costed deficit — and the goods receipt covers it. Expected values are worked out by hand.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
let supplierId = "";
let seed: { id: string; variant: string };

const as = (r: request.Test) => r.set("Cookie", [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);
const setPolicy = (productId: string, body: object) => as(request(app).put(`/api/v1/finance/stock/products/${productId}/policy`)).send({ reason: "owner decision", ...body });
const sells = async (variantId: string) => sellable(await stockOf(variantId), (await fillCapacity(prisma, { variantIds: [variantId] })).get(variantId) ?? 0);
const shown = async (slug: string) => (await getProductBySlug(slug))!.variants[0]!.stock;
const costState = (variantId: string) => prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId } });

async function buy(variantId: string, qty: number, unitPrice: number) {
  const po = await createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId, qtyOrdered: qty, unitPrice }] } as never, OWNER);
  await submitPurchaseOrder(po.id, OWNER);
  const approved = await approvePurchaseOrder(po.id, OWNER);
  const grn = await createGoodsReceipt({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: approved.lines[0]!.id, qtyAccepted: qty }] } as never, OWNER);
  await postGoodsReceipt(grn.id, {}, OWNER);
}
async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function booksMatch() {
  await postPending();
  const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity"] }, OWNER);
  expect(Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]))).toEqual({
    "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "ledger.integrity": "MATCHED",
  });
}
/** A jacket: one size, stock-tracked, sold from the shelf (not filled to order). */
async function jacket(costPrice: number | null = null) {
  const p = await createStockedProduct({ stocks: [0], basePrice: 1390 });
  await prisma.product.update({ where: { id: p.product.id }, data: { costPrice } });
  return { id: p.product.id, slug: p.product.slug, variant: p.variants[0]!.id };
}

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const s = await createStockedProduct({ stocks: [5], basePrice: 900 });
  seed = { id: s.product.id, variant: s.variants[0]!.id };
  await saveOpeningInventory([{ variantId: seed.variant, sku: "BTO-SEED", name: "seed", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  supplierId = (await createSupplier({ legalName: "Vitest Bought To Order Supplier" } as never, OWNER)).id;
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("the selling rule on a product sold from the shelf", () => {
  it("B-1: refused while stock isn't counted (untracked) — there would be nothing to count the owed units against", async () => {
    const j = await jacket();
    await prisma.product.update({ where: { id: j.id }, data: { trackInventory: false } });
    const r = await setPolicy(j.id, { policy: "UNLIMITED" });
    expect(r.status).toBe(400);
    expect(r.body.details?.code).toBe("STOCK_POLICY_NEEDS_TRACKING");
  });

  it("B-2: TRACKED (the default) still refuses past the shelf", async () => {
    const j = await jacket();
    expect(await sells(j.variant)).toBe(0);
    await expect(placeOrder([{ variantId: j.variant, quantity: 1 }])).rejects.toMatchObject({ statusCode: 409 });
    expect(await stockOf(j.variant)).toBe(0);
  });
});

describe("UNLIMITED: always on sale, every unit counted", () => {
  let j: { id: string; slug: string; variant: string };
  beforeAll(async () => {
    j = await jacket();
    await buy(j.variant, 2, 900);
  });

  it("B-3: set on a counted jacket — the shop shows it in stock; the change writes no stock and no movement", async () => {
    const moves = await prisma.stockMovement.count({ where: { variantId: j.variant } });
    const r = await setPolicy(j.id, { policy: "UNLIMITED" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await shown(j.slug)).toBe(MAX_LINE_QUANTITY);
    expect(await sells(j.variant)).toBeGreaterThanOrEqual(MAX_LINE_QUANTITY);
    expect(await stockOf(j.variant)).toBe(2);
    expect(await prisma.stockMovement.count({ where: { variantId: j.variant } })).toBe(moves);
  });

  it("B-4: an order of 5 with 2 on the shelf goes through: stock −3, 3 owed as a deficit, costed at the 900 average", async () => {
    const order = await placeOrder([{ variantId: j.variant, quantity: 5 }], { customerPhone: "01712000051" });
    expect(await stockOf(j.variant)).toBe(-3);
    expect(await costState(j.variant)).toMatchObject({ valuedQty: 0, deficitQty: 3 });
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id }, select: { unitCostSnapshot: true, unitCostSource: true } });
    expect(line).toEqual({ unitCostSnapshot: 90000, unitCostSource: "INVENTORY_PROVISIONAL" });
    await assertInventoryInvariants(j.variant);
  });

  it("B-5: the goods receipt of 8 covers the 3 owed: stock 5, no deficit, the books match", async () => {
    await buy(j.variant, 8, 910);
    expect(await stockOf(j.variant)).toBe(5);
    expect(await costState(j.variant)).toMatchObject({ deficitQty: 0, valuedQty: 5 });
    await booksMatch();
    await assertInventoryInvariants(j.variant);
  });
});

describe("never valued yet: the supplier price stands in", () => {
  it("B-6: sold before any purchase — provisional cost = the product's cost price, not nothing", async () => {
    const j = await jacket(810);
    expect((await setPolicy(j.id, { policy: "UNLIMITED" })).status).toBe(200);
    const order = await placeOrder([{ variantId: j.variant, quantity: 2 }], { customerPhone: "01712000052" });
    expect(await stockOf(j.variant)).toBe(-2);
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id }, select: { unitCostSnapshot: true, unitCostSource: true } });
    expect(line).toEqual({ unitCostSnapshot: 81000, unitCostSource: "INVENTORY_PROVISIONAL" });
    await buy(j.variant, 2, 810);
    expect(await stockOf(j.variant)).toBe(0);
    expect(await costState(j.variant)).toMatchObject({ deficitQty: 0 });
    await booksMatch();
  });
});

describe("BACKORDER: a limit on what may be owed", () => {
  it("B-7: BACKORDER 2 at zero: 2 sell, the 3rd is refused", async () => {
    const j = await jacket(810);
    expect((await setPolicy(j.id, { policy: "BACKORDER", backorderLimit: 2 })).status).toBe(200);
    expect(await sells(j.variant)).toBe(2);
    await placeOrder([{ variantId: j.variant, quantity: 2 }], { customerPhone: "01712000053" });
    expect(await stockOf(j.variant)).toBe(-2);
    await expect(placeOrder([{ variantId: j.variant, quantity: 1 }])).rejects.toMatchObject({ statusCode: 409 });
  });

  it("B-8: back to TRACKED stops selling past the shelf and rewrites nothing", async () => {
    const j = await jacket(810);
    expect((await setPolicy(j.id, { policy: "UNLIMITED" })).status).toBe(200);
    await placeOrder([{ variantId: j.variant, quantity: 1 }], { customerPhone: "01712000054" });
    const moves = await prisma.stockMovement.count({ where: { variantId: j.variant } });
    expect((await setPolicy(j.id, { policy: "TRACKED" })).status).toBe(200);
    await expect(placeOrder([{ variantId: j.variant, quantity: 1 }])).rejects.toMatchObject({ statusCode: 409 });
    expect(await stockOf(j.variant)).toBe(-1);
    expect(await prisma.stockMovement.count({ where: { variantId: j.variant } })).toBe(moves);
  });
});
