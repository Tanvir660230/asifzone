import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN, stockOf } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, getCutover, postCutover, updateCutoverLines } from "../finance/inventory-cutover.service";
import { projectOrder } from "../finance/commerce-accounting.service";
import { processFinancialEvent } from "../finance/events.service";
import { runReconciliation } from "../finance/reconciliation.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";
import { quickRefill } from "../manufacturing/quick-refill.service";
import { adjustVariantStock, stockMovedSettled } from "../../modules/inventory/inventory.service";
import { updateOrderStatus } from "../../modules/orders/order.service";

// docs/STOCK_HUB.md §4: attar ordered and not filled when costing goes live. The cutover starts the fill-to-order variant's
// deficit at its recipe's standard cost (the batch's approved material costs), held off the inventory account, so the
// true-up doesn't count those bottles twice (their cost is on the way to customers, their materials are on the shelf),
// the fill posts only actual − provisional, and the delivery books the cost of goods once. Nothing reaches 5150.

let OWNER: FinanceActor;
let admin = "";
let oil = "";
let bottle = "";
let attar = { id: "", variant: "" };
let orderId = "";
const RECIPE = 6 * 40 + 25; // 6 ml at 40 + a 25 bottle

async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function balance(mappingKey: string, partyId?: string) {
  const { business } = await getFinanceContext();
  const accountId = (await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key: mappingKey } } })).accountId;
  const lines = await prisma.journalLine.findMany({ where: { accountId, entry: { status: "POSTED", businessId: business.id }, ...(partyId ? { partyId } : {}) } });
  return Math.round(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) * 100) / 100;
}
async function checks() {
  await postPending();
  const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "inventory.order_cost_links", "manufacturing.wip", "ledger.integrity", "events.unposted"] }, OWNER);
  return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
}
const ALL_MATCHED = {
  "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "inventory.order_cost_links": "MATCHED",
  "manufacturing.wip": "MATCHED", "ledger.integrity": "MATCHED", "events.unposted": "MATCHED",
};
const material = async (name: string, unit: string, qty: number) => {
  const id = (await createMaterial({ name: `Vitest ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `FTOC-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
  await adjustVariantStock(id, qty, "ADJUSTMENT", admin, "count before go-live");
  return id;
};

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
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "FTOC-SEED", name: "seed", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);

  // Before costing: materials on the shelf, the recipe, and three bottles ordered and not filled.
  oil = await material("Cut oil", "ml", 600);
  bottle = await material("Cut bottle", "pcs", 100);
  const p = await createStockedProduct({ stocks: [0], basePrice: 350 });
  await prisma.product.update({ where: { id: p.product.id }, data: { fillToOrder: true } });
  const bom = await createBom({ productId: p.product.id, lines: [{ materialVariantId: oil, qtyPerUnit: "6", wastagePct: "0" }, { materialVariantId: bottle, qtyPerUnit: "1", wastagePct: "0" }] } as never, OWNER);
  await approveBom(bom.id, OWNER);
  attar = { id: p.product.id, variant: p.variants[0]!.id };
  orderId = (await placeOrder([{ variantId: attar.variant, quantity: 3 }], { customerPhone: "01712000041" })).id;
  expect(await stockOf(attar.variant)).toBe(-3);
  // As the go-live gives open attar lines: today's cost of a bottle (the recipe cost).
  await prisma.orderItem.updateMany({ where: { orderId }, data: { unitCostSnapshot: RECIPE * 100, unitCostSource: "CATALOG" } });
  await stockMovedSettled();
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

describe("cutover with attar ordered and not filled", () => {
  it("the deficit starts at the recipe cost (unbooked); the unfilled bottles add nothing to the true-up; checks match", async () => {
    await draftCutover({}, OWNER);
    await updateCutoverLines([
      { variantId: oil, unitCost: 40, valuationStatus: "KNOWN", costSource: "OWNER", evidence: "count" },
      { variantId: bottle, unitCost: 25, valuationStatus: "KNOWN", costSource: "OWNER", evidence: "count" },
    ], OWNER);
    const preview = (await getCutover()).preview!;
    expect(preview).toMatchObject({ unfilledAtRecipeCost: 3 * RECIPE, unfilledUnits: 3 });
    // valuation of the materials + the open order's cost on the way − the same bottles unfilled − the ledger (the seed)
    expect(preview.adjustment).toBe(600 * 40 + 100 * 25);
    await approveCutover({ acknowledgeMissing: true }, OWNER);
    const posted = await postCutover(OWNER);
    expect(posted.batch.summary).toMatchObject({ unfilledAtRecipeCost: 3 * RECIPE, unfilledUnits: 3, deficitUnits: 3, adjustment: 600 * 40 + 100 * 25 });
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: attar.variant } })).toMatchObject({ deficitQty: 3, deficitLayers: [{ qty: 3, unitCostMinor: RECIPE * 100, unbooked: true }] });
    const entry = await prisma.inventoryValuationEntry.findFirstOrThrow({ where: { variantId: attar.variant, kind: "CUTOVER" } });
    expect(entry.valuationStatus).toBe("ESTIMATED");
    expect(await checks()).toEqual(ALL_MATCHED);
  });

  it("filling them posts nothing to 5150 at the same prices; delivery books the cost of goods once; checks match", async () => {
    const adjBefore = await balance("cogs.cost_adjustments");
    await quickRefill({ variantId: attar.variant, quantity: 3 }, OWNER, `ftoc-${RUN}`);
    expect(await stockOf(attar.variant)).toBe(0);
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: attar.variant } })).toMatchObject({ deficitQty: 0, deficitLayers: [], valuedQty: 0 });
    expect(await checks()).toEqual(ALL_MATCHED);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore);

    for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const) await updateOrderStatus(orderId, { status: s }, admin);
    await projectOrder(orderId);
    await postPending();
    expect(await balance("cogs.goods", orderId)).toBe(3 * RECIPE);
    expect(await prisma.financeException.count({ where: { orderId, kind: "MISSING_COST" } })).toBe(0);
    expect(await balance("cogs.cost_adjustments")).toBe(adjBefore);
    expect(await checks()).toEqual(ALL_MATCHED);
    await assertInventoryInvariants(attar.variant);
  });
});
