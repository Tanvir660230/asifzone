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
import { approveCostEntry, createCostEntry, updateCostEntry, voidCostEntry } from "./production-costs.service";
import { approveProductionOrder as approveMo, createProductionOrder as createMo, getProductionOrder } from "./production-orders.service";
import { createProductionReceipt, postProductionReceipt, reverseProductionReceipt } from "./production-receipts.service";
import { allocate, closeProductionOrder } from "./production-close.service";
import { adjustVariantStock } from "../../modules/inventory/inventory.service";
import { createSupplierInvoice, postSupplierInvoice, supplierOpenItems, voidSupplierInvoice } from "../finance/supplier-invoices.service";

// Manufacturing M2 (docs/MANUFACTURING.md §6): material issued to and returned from a production order, after a real
// valuation cutover and a real purchase — so the checks prove WIP and inventory against the documents and the valuation.

let OWNER: FinanceActor;
let STAFF: FinanceActor;
let approverId = "";
const SEE = { canSeeCost: true };
let twill = "";
let label = "";
let moId = "";
let twillLine = "";
let labelLine = "";
let capVariant = "";
let capProductId = "";

async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function checks() {
  await postPending();
  const r = await runReconciliation({ checks: ["manufacturing.wip", "inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity", "events.unposted", "purchasing.grni", "manufacturing.production_accrual"] }, OWNER);
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
  // A real second admin: separation of duties needs a different person, and stock movements reference the admin.
  approverId = (await prisma.adminUser.upsert({ where: { email: "vitest-approver@example.com" }, update: { role: "FINANCE_ADMIN" }, create: { email: "vitest-approver@example.com", name: "Vitest Approver", role: "FINANCE_ADMIN", passwordHash: "x" } })).id;
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
  capVariant = cap.variants[0]!.id;
  capProductId = cap.product.id;
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
    expect(r.wip).toMatchObject({ materials: 2000, costs: 0, total: 2000 });
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
    expect(r.wip).toMatchObject({ materials: 3850, costs: 0, total: 3850 });
    expect(await stock(twill)).toBe(11_500);
    const moves = await listMaterialMoves(moId);
    expect(moves.moves.map((m) => [m.kind, m.quantity])).toEqual([["ISSUE", 20_000], ["ISSUE", 19_500], ["RETURN", 1000]]);
    await expect(prisma.productionMaterialMove.updateMany({ where: { productionOrderId: moId }, data: { note: "x" } })).rejects.toThrow(/append-only/);
    allMatched(await checks());
    expect(await wipBalance()).toBe(3850);
  });
});

describe("production costs", () => {
  let cmt = "";
  let freight = "";
  let supplierId = "";
  let entryId = "";
  const APPROVER = (): FinanceActor => ({ type: "ADMIN", adminId: approverId, label: "approver@test", permissions: [...PERMISSIONS] });

  it("are entered as quantity × rate (exact) or an amount; one live entry per supplier reference", async () => {
    cmt = (await prisma.productionCostCategory.findFirstOrThrow({ where: { code: "CMT" } })).id;
    freight = (await prisma.productionCostCategory.findFirstOrThrow({ where: { code: "FREIGHT" } })).id;
    supplierId = (await prisma.supplier.findFirstOrThrow({ where: { legalName: "Vitest Textiles" } })).id;
    const e = await createCostEntry(moId, { categoryId: cmt, supplierId, reference: "CH-101", description: "Stitching 1,000 caps", quantity: "1000", unitRate: "45.5" }, STAFF);
    expect(e).toMatchObject({ status: "DRAFT", amount: 45_500, quantity: "1000", unitRate: "45.5" });
    entryId = e.id;
    await expect(createCostEntry(moId, { categoryId: cmt, supplierId, reference: "ch-101 ", description: "same bill again", amount: 100 }, STAFF)).rejects.toMatchObject({ statusCode: 409 });
    const edited = await updateCostEntry(entryId, { unitRate: "45" , quantity: "1000" }, STAFF);
    expect(edited.amount).toBe(45_000);
    await expect(createCostEntry(moId, { categoryId: freight, description: "both", amount: 10, quantity: "1", unitRate: "1" }, STAFF)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("are approved only by someone else holding manufacturing.approve, accrue into WIP, and are then immutable", async () => {
    await expect(approveCostEntry(entryId, STAFF)).rejects.toMatchObject({ statusCode: 403 });
    const ownCost = await createCostEntry(moId, { categoryId: freight, supplierId, reference: "TR-9", description: "Truck to factory", amount: 1200 }, OWNER);
    await expect(approveCostEntry(ownCost.id, OWNER)).rejects.toMatchObject({ statusCode: 409 }); // its own enterer
    const wipBefore = await wipBalance();
    expect((await approveCostEntry(entryId, APPROVER())).status).toBe("APPROVED");
    expect((await approveCostEntry(entryId, APPROVER())).status).toBe("APPROVED"); // idempotent
    await approveCostEntry(ownCost.id, APPROVER());
    allMatched(await checks());
    expect(await wipBalance()).toBe(Math.round((wipBefore + 45_000 + 1200) * 100) / 100);
    await expect(prisma.productionCostEntry.update({ where: { id: entryId }, data: { amount: 1 } })).rejects.toThrow(/immutable/);
    const o = await getProductionOrder(moId, SEE);
    expect(o.wip).toMatchObject({ costs: 46_200 });
    expect(o.comparison!.categories.find((c) => c.category.code === "CMT")).toMatchObject({ planned: 0, actual: 45_000, variance: 45_000 });
    expect(o.comparison!.total.actual).toBe(o.wip!.total);
  });

  it("void: an approved cost's accrual is reversed; the reference can then be used again", async () => {
    const wipBefore = await wipBalance();
    await expect(voidCostEntry(entryId, "wrong rate", STAFF)).rejects.toMatchObject({ statusCode: 403 });
    expect((await voidCostEntry(entryId, "Rate was ৳44 per piece", APPROVER())).status).toBe("VOID");
    allMatched(await checks());
    expect(await wipBalance()).toBe(Math.round((wipBefore - 45_000) * 100) / 100);
    const again = await createCostEntry(moId, { categoryId: cmt, supplierId, reference: "CH-101", description: "Stitching (corrected)", quantity: "1000", unitRate: "44" }, STAFF);
    await approveCostEntry(again.id, APPROVER());
    allMatched(await checks());
    await expect(prisma.productionCostEntry.update({ where: { id: entryId }, data: { status: "APPROVED" } })).rejects.toThrow(/final/);
  });
});

describe("deliveries and finished goods", () => {
  let lineId = "";
  let secondReceipt = "";
  const APPROVER = (): FinanceActor => ({ type: "ADMIN", adminId: approverId, label: "approver@test", permissions: [...PERMISSIONS] });

  it("a receipt reconciles delivered = accepted + rejected + rework; rejects need a reason", async () => {
    lineId = (await getProductionOrder(moId, SEE)).lines[0]!.id;
    await expect(createProductionReceipt(moId, { lines: [{ orderLineId: lineId, delivered: 10, accepted: 8, rejected: 1, rework: 0, rejectReason: "x" }] }, STAFF, SEE)).rejects.toMatchObject({ statusCode: 400 });
    await expect(createProductionReceipt(moId, { lines: [{ orderLineId: lineId, delivered: 10, accepted: 9, rejected: 1, rework: 0 }] }, STAFF, SEE)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("posting puts accepted units into stock at the provisional unit cost, moves their value out of WIP, once", async () => {
    // actual to date = materials 3,850 + approved costs 45,200 (freight 1,200 + CMT 44,000) = 49,050 over 1,000 planned → 49.05
    const draft = await createProductionReceipt(moId, { deliveryRef: "DN-77", inspectionNotes: "AQL 2.5", lines: [{ orderLineId: lineId, delivered: 415, accepted: 400, rejected: 10, rework: 5, rejectReason: "Crooked logo" }] }, STAFF, SEE);
    const wipBefore = await wipBalance();
    const [a, b] = await Promise.all([postProductionReceipt(draft.id, {}, STAFF, SEE), postProductionReceipt(draft.id, {}, STAFF, SEE)]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const posted = a.replayed ? b.receipt : a.receipt;
    expect(posted).toMatchObject({ status: "POSTED", provisionalUnitCost: 49.05, value: 19_620 });
    expect(await stock(capVariant)).toBe(400);
    const state = await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: capVariant } });
    expect([state.valuedQty, Number(state.value)]).toEqual([400, 19_620]);
    const o = await getProductionOrder(moId, SEE);
    expect(o.status).toBe("PARTIALLY_RECEIVED");
    expect(o.lines[0]).toMatchObject({ deliveredQty: 415, acceptedQty: 400, rejectedQty: 10, reworkQty: 5, outstanding: 600 });
    expect(o.progress).toMatchObject({ planned: 1000, accepted: 400, rejected: 10, outstanding: 600 });
    allMatched(await checks());
    expect(await wipBalance()).toBe(Math.round((wipBefore - 19_620) * 100) / 100);
    await expect(prisma.productionOrderLine.update({ where: { id: lineId }, data: { acceptedQty: 1 } })).rejects.toThrow(/derived/);
    await expect(prisma.productionReceipt.update({ where: { id: draft.id }, data: { deliveryRef: "edited" } })).rejects.toThrow(/immutable/);
  });

  it("accepting beyond the plan needs an approver and a reason; the order is then received; a reversal takes the units back out", async () => {
    const r2 = await createProductionReceipt(moId, { lines: [{ orderLineId: lineId, delivered: 650, accepted: 650 }] }, STAFF, SEE);
    secondReceipt = r2.id;
    await expect(postProductionReceipt(r2.id, { overReceiptReason: "extra" }, STAFF, SEE)).rejects.toMatchObject({ statusCode: 409 });
    await postProductionReceipt(r2.id, { overReceiptReason: "Factory made a full last bundle" }, OWNER, SEE);
    expect((await getProductionOrder(moId, SEE)).status).toBe("RECEIVED");
    expect(await stock(capVariant)).toBe(1050);
    allMatched(await checks());
    await expect(reverseProductionReceipt(secondReceipt, "counted twice", STAFF, SEE)).rejects.toMatchObject({ statusCode: 403 });
    const rev = await reverseProductionReceipt(secondReceipt, "Counted twice at the gate", APPROVER(), SEE);
    expect(rev.receipt.status).toBe("REVERSED");
    expect(await stock(capVariant)).toBe(400);
    expect((await getProductionOrder(moId, SEE)).status).toBe("PARTIALLY_RECEIVED");
    allMatched(await checks());
  });

  it("goods never enter stock at zero cost: an order with nothing known about its cost can't post a receipt", async () => {
    const supplierId = (await prisma.supplier.findFirstOrThrow({ where: { legalName: "Vitest Textiles" } })).id;
    const bare = await createMo({ productId: capProductId, producerSupplierId: supplierId, lines: [{ variantId: capVariant, plannedQty: 50 }] }, OWNER, SEE);
    await approveMo(bare.id, OWNER, SEE);
    const r = await createProductionReceipt(bare.id, { lines: [{ orderLineId: bare.lines[0]!.id, delivered: 50, accepted: 50 }] }, STAFF, SEE);
    await expect(postProductionReceipt(r.id, {}, STAFF, SEE)).rejects.toMatchObject({ statusCode: 409 });
    expect(await stock(capVariant)).toBe(400);
  });
});

describe("close, final cost and late costs", () => {
  const APPROVER = (): FinanceActor => ({ type: "ADMIN", adminId: approverId, label: "approver@test", permissions: [...PERMISSIONS] });
  const capValue = async () => Number((await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: capVariant } })).value);

  it("allocates exactly by weight (largest remainder)", () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(-1000, [2, 1])).toEqual([-667, -333]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
  });

  it("the checklist holds the close: draft costs, an oversized or unexplained loss, no approver", async () => {
    const cmt = (await prisma.productionCostCategory.findFirstOrThrow({ where: { code: "CMT" } })).id;
    const draft = await createCostEntry(moId, { categoryId: cmt, description: "Buttons sewing (unconfirmed)", amount: 300 }, STAFF);
    await expect(closeProductionOrder(moId, {}, STAFF, SEE)).rejects.toMatchObject({ statusCode: 403 });
    await expect(closeProductionOrder(moId, {}, OWNER, SEE)).rejects.toMatchObject({ details: { code: "CLOSE_DRAFT_COSTS" } });
    for (const c of await prisma.productionCostEntry.findMany({ where: { productionOrderId: moId, status: "DRAFT" } })) await voidCostEntry(c.id, "Not part of this order", APPROVER());
    expect((await prisma.productionCostEntry.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("VOID");
    await expect(closeProductionOrder(moId, { abnormalLoss: 500 }, OWNER, SEE)).rejects.toMatchObject({ details: { code: "ABNORMAL_LOSS_REASON" } });
    await expect(closeProductionOrder(moId, { abnormalLoss: 1_000_000, abnormalLossReason: "fire" }, OWNER, SEE)).rejects.toMatchObject({ details: { code: "ABNORMAL_LOSS_TOO_LARGE" } });
    expect((await getProductionOrder(moId, SEE)).status).toBe("PARTIALLY_RECEIVED");
  });

  it("closing revalues the units still held, sends the sold share to 5150, writes off the abnormal loss, and empties WIP", async () => {
    // 100 of the 400 finished caps leave first (at the provisional 49.05) — they carry their share of the true-up to 5150.
    await adjustVariantStock(capVariant, -100, "DAMAGED", approverId, "water damage");
    await postPending();
    expect(await capValue()).toBe(14_715);
    const before = await getProductionOrder(moId, SEE);
    expect(before.wip!.total).toBe(29_430); // 49,050 actual − 19,620 transferred
    const wipBefore = await wipBalance();
    const closed = await closeProductionOrder(moId, { abnormalLoss: 430, abnormalLossReason: "Bundle lost in transit", note: "All deliveries in" }, OWNER, SEE);
    expect(closed.status).toBe("CLOSED");
    expect(closed.wip!.total).toBe(0);
    // transfer 29,000 over 400 accepted: 300 still held → 21,750 revalues stock, 100 gone → 7,250 to 5150
    expect(closed.finalCost).toMatchObject({ total: 49_050, abnormalLoss: 430, goods: 48_620, perAcceptedUnit: 121.55 });
    expect(closed.finalCost!.settlements[0]).toMatchObject({ kind: "CLOSE", residual: 29_430, transfer: 29_000, abnormalLoss: 430, heldShare: 21_750, soldShare: 7_250 });
    expect(await capValue()).toBe(36_465);
    expect(closed.performance).toMatchObject({ yieldPct: 96.39, rejectionPct: 2.41 });
    allMatched(await checks());
    expect(await wipBalance()).toBe(Math.round((wipBefore - 29_430) * 100) / 100);
    // replay; a closed order takes no deliveries or materials and is final
    expect((await closeProductionOrder(moId, {}, OWNER, SEE)).status).toBe("CLOSED");
    await expect(createProductionReceipt(moId, { lines: [{ orderLineId: closed.lines[0]!.id, delivered: 1, accepted: 1 }] }, STAFF, SEE)).rejects.toMatchObject({ statusCode: 409 });
    await expect(issueMaterials(moId, { lines: [{ materialLineId: twillLine, quantity: 1 }] }, OWNER, SEE)).rejects.toMatchObject({ statusCode: 409 });
    await expect(prisma.productionSettlement.updateMany({ where: { productionOrderId: moId }, data: { abnormalLossReason: "x" } })).rejects.toThrow(/append-only/);
  });

  it("a late cost after close (and its void) flows to the finished goods the same way — WIP stays zero, no history rewritten", async () => {
    const freight = (await prisma.productionCostCategory.findFirstOrThrow({ where: { code: "CMT" } })).id;
    const late = await createCostEntry(moId, { categoryId: freight, description: "Courier bill for the last delivery", amount: 800 }, STAFF);
    await approveCostEntry(late.id, APPROVER());
    let o = await getProductionOrder(moId, SEE);
    expect(o.wip!.total).toBe(0);
    expect(o.finalCost!.total).toBe(49_850);
    expect(o.finalCost!.settlements.at(-1)).toMatchObject({ kind: "LATE_COST", transfer: 800, heldShare: 600, soldShare: 200 });
    expect(await capValue()).toBe(37_065);
    allMatched(await checks());
    await voidCostEntry(late.id, "Billed to the customer instead", APPROVER());
    o = await getProductionOrder(moId, SEE);
    expect(o.wip!.total).toBe(0);
    expect(o.finalCost!.settlements.at(-1)).toMatchObject({ kind: "LATE_COST", transfer: -800, heldShare: -600, soldShare: -200 });
    expect(await capValue()).toBe(36_465);
    allMatched(await checks());
  });
});

describe("the producer's invoice (Phase 4E)", () => {
  const APPROVER = (): FinanceActor => ({ type: "ADMIN", adminId: approverId, label: "approver@test", permissions: [...PERMISSIONS] });

  it("bills an approved production cost at exactly its amount and clears its accrual — the cost is never booked twice", async () => {
    const supplierId = (await prisma.supplier.findFirstOrThrow({ where: { legalName: "Vitest Textiles" } })).id;
    const open = await supplierOpenItems(supplierId);
    const cmt = open.productionCosts.find((c) => c.reference === "CH-101")!;
    expect(cmt).toMatchObject({ amount: 44_000 });
    await expect(createSupplierInvoice({ kind: "INVOICE", supplierId, supplierRef: "VT-INV-9", lines: [{ lineType: "PRODUCTION_COST", productionCostEntryId: cmt.productionCostEntryId, quantity: 1, unitPrice: 45_000 }] } as never, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    const bill = await createSupplierInvoice({ kind: "INVOICE", supplierId, supplierRef: "VT-INV-9", lines: [{ lineType: "PRODUCTION_COST", productionCostEntryId: cmt.productionCostEntryId, quantity: 1, unitPrice: 44_000 }] } as never, OWNER);
    await postSupplierInvoice(bill.id, {}, OWNER);
    const r = await runReconciliation({ checks: ["manufacturing.production_accrual", "payables.subledger", "manufacturing.wip", "ledger.integrity"] }, OWNER);
    await postPending();
    const again = await runReconciliation({ checks: ["manufacturing.production_accrual", "payables.subledger", "manufacturing.wip", "ledger.integrity", "events.unposted"] }, OWNER);
    expect(r.results.length).toBe(4);
    expect(Object.fromEntries(again.results.map((x) => [x.checkKey, x.status]))).toEqual({ "manufacturing.production_accrual": "MATCHED", "payables.subledger": "MATCHED", "manufacturing.wip": "MATCHED", "ledger.integrity": "MATCHED", "events.unposted": "MATCHED" });
    expect((await supplierOpenItems(supplierId)).productionCosts.find((c) => c.reference === "CH-101")).toBeUndefined();
    // an invoiced cost can't be voided; void the bill first
    await expect(voidCostEntry(cmt.productionCostEntryId, "duplicate", APPROVER())).rejects.toMatchObject({ statusCode: 409 });
    await voidSupplierInvoice(bill.id, "Wrong supplier reference", OWNER);
    allMatched(await checks());
  });
});
