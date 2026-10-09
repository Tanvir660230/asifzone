import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables } from "../../test-fixtures";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { getFinanceContext } from "../finance/finance-context";
import { processFinancialEvent } from "../finance/events.service";
import { runReconciliation } from "../finance/reconciliation.service";
import { createSupplier } from "../finance/suppliers.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { approvePurchaseOrder, createPurchaseOrder, submitPurchaseOrder } from "../finance/purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt } from "../finance/goods-receipts.service";
import type { FinanceActor } from "../finance/finance-audit";
import { ensureManufacturingSetup } from "./manufacturing-setup.service";
import { createMaterial } from "./materials.service";
import { approveBom, createBom } from "./boms.service";
import { approveProductionOrder, cancelProductionOrder, createProductionOrder } from "./production-orders.service";
import { declareMaterialUsage, issueMaterials, listMaterialMoves, returnMaterials } from "./material-custody.service";

// Manufacturing M2 (docs/MANUFACTURING.md §6): material issued to and returned from a production order, after a real
// valuation cutover and a real purchase — so the checks prove WIP and inventory against the documents and the valuation.

let OWNER: FinanceActor;
let STAFF: FinanceActor;
const SEE = { canSeeCost: true };
let twill = "";
let label = "";
let moId = "";
let twillLine = "";
let labelLine = "";

async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function checks() {
  await postPending();
  const r = await runReconciliation({ checks: ["manufacturing.wip", "inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity", "events.unposted", "purchasing.grni"] }, OWNER);
  return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
}
const allMatched = (r: Record<string, string>) => expect(r).toEqual(Object.fromEntries(Object.keys(r).map((k) => [k, "MATCHED"])));
const stock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
async function wipBalance() {
  const { business } = await getFinanceContext();
  const m = await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key: "asset.wip" } } });
  const s = await prisma.journalLine.aggregate({ where: { accountId: m.accountId, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100;
}

beforeAll(async () => {
  await purgeFinanceTables();
  const owner = await ownerId();
  OWNER = { type: "ADMIN", adminId: owner, label: "owner@test", permissions: [...PERMISSIONS] };
  STAFF = { type: "ADMIN", adminId: owner, label: "staff@test", permissions: PERMISSIONS.filter((p) => p !== "manufacturing.approve" && p !== "purchasing.approve" && p !== "costing.read") };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  await updateBusinessSettings({ openingDate: "2026-01-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "MC-SEED", name: "seed", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-01-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);

  // Material created after activation (in costing from its first movement), bought on a purchase order: 50,000 cm @ 0.10.
  const run = Date.now().toString(36);
  const m = await createMaterial({ name: "Vitest Twill M2", stockUnit: "cm", variants: [{ sku: `M2-TWILL-${run}`, spec: "150 cm" }] }, OWNER, SEE);
  twill = m.variants[0]!.id;
  const l = await createMaterial({ name: "Vitest Label M2", stockUnit: "pcs", variants: [{ sku: `M2-LABEL-${run}`, spec: "Woven" }] }, OWNER, SEE);
  label = l.variants[0]!.id;
  const supplierId = (await createSupplier({ legalName: "Vitest Textiles" } as never, OWNER)).id;
  const po = await createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId: twill, qtyOrdered: 50_000, unitPrice: 0.1 }] } as never, OWNER);
  await submitPurchaseOrder(po.id, OWNER);
  const approved = await approvePurchaseOrder(po.id, OWNER);
  const grn = await createGoodsReceipt({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: approved.lines[0]!.id, qtyAccepted: 50_000 }] } as never, OWNER);
  await postGoodsReceipt(grn.id, {}, OWNER);

  const cap = await createStockedProduct({ stocks: [0], basePrice: 900 });
  const bom = await createBom({ productId: cap.product.id, lines: [{ materialVariantId: twill, qtyPerUnit: "37.5", wastagePct: "4" }, { materialVariantId: label, qtyPerUnit: "1", suppliedBy: "PRODUCER" }] }, OWNER);
  await approveBom(bom.id, OWNER);
  const mo = await createProductionOrder({ productId: cap.product.id, bomId: bom.id, producerSupplierId: supplierId, lines: [{ variantId: cap.variants[0]!.id, plannedQty: 1000 }] }, OWNER, SEE);
  moId = mo.id;
  twillLine = mo.materials.find((x) => x.materialVariantId === twill)!.id;
  labelLine = mo.materials.find((x) => x.materialVariantId === label)!.id;
}, 120_000);

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

describe("issuing material", () => {
  it("is refused before the plan is approved", async () => {
    await expect(issueMaterials(moId, { lines: [{ materialLineId: twillLine, quantity: 1 }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409 });
    await approveProductionOrder(moId, OWNER, SEE);
    allMatched(await checks());
  });

  it("moves stock and value from inventory into WIP for the order, starts production, and is idempotent", async () => {
    const r = await issueMaterials(moId, { lines: [{ materialLineId: twillLine, quantity: 20_000 }], note: "first cut" }, OWNER, { ...SEE, requestKey: "issue-req-0001" });
    expect(r.status).toBe("IN_PRODUCTION");
    expect(await stock(twill)).toBe(30_000);
    const line = r.materials.find((m) => m.id === twillLine)!;
    expect(line).toMatchObject({ issuedQty: 20_000, atProducer: 20_000, issuedValue: 2000 });
    expect(r.wip).toEqual({ materials: 2000 });
    const again = await issueMaterials(moId, { lines: [{ materialLineId: twillLine, quantity: 20_000 }] }, OWNER, { ...SEE, requestKey: "issue-req-0001" });
    expect(again.replayed).toBe(true);
    expect(await stock(twill)).toBe(30_000);
    allMatched(await checks());
    expect(await wipBalance()).toBe(2000);
    const ev = await prisma.journalLine.findFirstOrThrow({ where: { partyType: "ProductionOrder", partyId: moId, debit: { gt: 0 } } });
    expect(Number(ev.debit)).toBe(2000);
  });

  it("beyond the plan needs an approver and a reason; producer-supplied material and more than stock are refused", async () => {
    await expect(issueMaterials(moId, { lines: [{ materialLineId: twillLine, quantity: 19_500 }], overIssueReason: "extra lining" }, STAFF, SEE)).rejects.toMatchObject({ statusCode: 409 });
    await expect(issueMaterials(moId, { lines: [{ materialLineId: twillLine, quantity: 19_500 }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409 });
    await issueMaterials(moId, { lines: [{ materialLineId: twillLine, quantity: 19_500 }], overIssueReason: "Cutting waste on the first roll" }, OWNER, SEE); // 39,500 > 39,000 planned
    await expect(issueMaterials(moId, { lines: [{ materialLineId: labelLine, quantity: 10 }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 400 });
    await expect(issueMaterials(moId, { lines: [{ materialLineId: twillLine, quantity: 20_000 }], overIssueReason: "more" }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409 }); // 10,500 left
    expect(await stock(twill)).toBe(10_500);
    await expect(prisma.productionMaterialLine.update({ where: { id: twillLine }, data: { issuedQty: 1 } })).rejects.toThrow(/derived/);
    await expect(cancelProductionOrder(moId, "changed mind", OWNER, SEE)).rejects.toMatchObject({ statusCode: 409 });
    allMatched(await checks());
  });
});

describe("usage and returns", () => {
  it("consumption and scrap are declared within custody; only what is still at the producer comes back, at the issued cost", async () => {
    await expect(declareMaterialUsage(moId, { lines: [{ materialLineId: twillLine, consumedQty: 39_000, scrappedQty: 1000 }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409 });
    const declared = await declareMaterialUsage(moId, { lines: [{ materialLineId: twillLine, consumedQty: 37_000, scrappedQty: 1500 }] }, OWNER, SEE);
    expect(declared.materials.find((m) => m.id === twillLine)).toMatchObject({ consumedQty: 37_000, scrappedQty: 1500, atProducer: 1000 });
    await expect(returnMaterials(moId, { lines: [{ materialLineId: twillLine, quantity: 1200 }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409 });
    const r = await returnMaterials(moId, { lines: [{ materialLineId: twillLine, quantity: 1000 }], note: "offcuts back" }, OWNER, SEE);
    const line = r.materials.find((m) => m.id === twillLine)!;
    expect(line).toMatchObject({ returnedQty: 1000, atProducer: 0, issuedValue: 3950, returnedValue: 100 });
    expect(r.wip).toEqual({ materials: 3850 });
    expect(await stock(twill)).toBe(11_500);
    const moves = await listMaterialMoves(moId);
    expect(moves.moves.map((m) => [m.kind, m.quantity])).toEqual([["ISSUE", 20_000], ["ISSUE", 19_500], ["RETURN", 1000]]);
    await expect(prisma.productionMaterialMove.updateMany({ where: { productionOrderId: moId }, data: { note: "x" } })).rejects.toThrow(/append-only/);
    allMatched(await checks());
    expect(await wipBalance()).toBe(3850);
  });
});
