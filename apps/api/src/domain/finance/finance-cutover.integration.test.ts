import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables } from "../../test-fixtures";
import { createOrder, updateOrderStatus } from "../../modules/orders/order.service";
import { adjustVariantStock } from "../../modules/inventory/inventory.service";
import { checkout, trackOrder } from "../../test-fixtures";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { getFinanceContext } from "./finance-context";
import { runReconciliation } from "./reconciliation.service";
import { processFinancialEvent } from "./events.service";
import type { FinanceActor } from "./finance-audit";
import { approveCutover, draftCutover, getCutover, inventoryLedgerBridge, listCutoverLines, postCutover, reopenCutover, updateCutoverLines, updateCutoverSettings } from "./inventory-cutover.service";

// Financial Core Phase 4C (docs/FINANCE_PHASE_4C.md): the valuation cutover against the real database — draft proposals,
// approval and its freeze, the atomic post (first valuation per variant at the stock AT POST, one true-up journal, one-way
// activation), idempotent and concurrent posting, and the invariant the cutover establishes:
//   inventory account = valuation + in-transit (the inventory.valuation_vs_ledger check).
// The cutover is business-wide, so it covers every stock-tracked variant in the test database; assertions on totals are
// made against the batch's own figures.

let OWNER: FinanceActor;
const v: Record<string, { id: string; productId: string }> = {};
let inTransitOrderId = "";

async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: "RECEIVED" }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function line(name: string) {
  return prisma.inventoryCutoverLine.findFirstOrThrow({ where: { variantId: v[name]!.id } });
}
async function product(name: string, stock: number, opts: { productCost?: number | null; tracked?: boolean } = {}) {
  const p = await createStockedProduct({ stocks: [stock], basePrice: 1000 });
  await prisma.product.update({ where: { id: p.product.id }, data: { costPrice: opts.productCost ?? null, trackInventory: opts.tracked ?? true } });
  v[name] = { id: p.variants[0]!.id, productId: p.product.id };
}
const checks = async (keys: string[]) => Object.fromEntries((await runReconciliation({ checks: keys }, OWNER)).results.map((r) => [r.checkKey, r]));

beforeAll(async () => {
  await purgeFinanceTables();
  const admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-01-01", reason: "books start" }, OWNER);

  await product("A", 10, { productCost: 120 }); // counted at opening at 100 (KNOWN) → the count's cost wins over the catalog
  await product("B", 5); // no cost anywhere → MISSING
  await product("C", 0, { productCost: 50 }); // catalog only → ESTIMATED
  await product("U", 3, { productCost: 70, tracked: false }); // untracked → never costed
  await saveOpeningInventory([{ variantId: v.A!.id, sku: "A-OPEN", name: "A at opening", quantity: 10, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV-OPEN-1", valuationDate: "2026-01-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER); // Dr inventory 1,000 / Cr opening balance equity 1,000

  // An order placed before the cutover and not yet recognised: 2 × A left stock at the catalog cost 120 (in transit).
  const o = await createOrder(checkout([{ variantId: v.A!.id, quantity: 2 }]));
  trackOrder(o.id);
  inTransitOrderId = o.id;
}, 60_000);

afterAll(async () => {
  await purgeFinanceTables(); // the valuation ledger first: it protects the variants and movements from deletion
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`UPDATE "OrderItem" SET "costMovementId" = NULL WHERE "costMovementId" IS NOT NULL`);
  });
  await cleanupFixtures();
});

describe("draft", () => {
  it("proposes a labelled cost for every stock-tracked variant: opening count (KNOWN) › catalog (ESTIMATED) › none (MISSING)", async () => {
    const { batch, summary } = await draftCutover({ notes: "first cutover" }, OWNER);
    expect(batch.status).toBe("DRAFT");
    expect(summary.lines).toBeGreaterThanOrEqual(3);
    expect(await line("A")).toMatchObject({ valuationStatus: "KNOWN", costSource: "OPENING_COUNT", draftQuantity: 8 });
    expect(Number((await line("A")).unitCost)).toBe(100);
    expect(await line("B")).toMatchObject({ valuationStatus: "MISSING", costSource: "NONE", unitCost: null, draftQuantity: 5 });
    expect(await line("C")).toMatchObject({ valuationStatus: "ESTIMATED", costSource: "CATALOG_PRODUCT", draftQuantity: 0 });
    expect(await prisma.inventoryCutoverLine.count({ where: { variantId: v.U!.id } })).toBe(0);
    const audit = await prisma.financeAuditEntry.findFirst({ where: { action: "cutover.draft", entityId: batch.id } });
    expect(audit).not.toBeNull();
  });

  it("validates line edits: KNOWN needs evidence, MISSING has no cost; unknown variants are refused", async () => {
    await expect(updateCutoverLines([{ variantId: v.C!.id, unitCost: 55, valuationStatus: "KNOWN", costSource: "OWNER", evidence: null }], OWNER)).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateCutoverLines([{ variantId: v.C!.id, unitCost: 55, valuationStatus: "MISSING", costSource: "NONE" }], OWNER)).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateCutoverLines([{ variantId: v.U!.id, unitCost: 1, valuationStatus: "ESTIMATED", costSource: "OWNER" }], OWNER)).rejects.toMatchObject({ statusCode: 404 });
    await updateCutoverLines([{ variantId: v.C!.id, unitCost: 55, valuationStatus: "KNOWN", costSource: "SUPPLIER_INVOICE", evidence: "INV-C-7" }], OWNER);
    expect(await line("C")).toMatchObject({ valuationStatus: "KNOWN", costSource: "SUPPLIER_INVOICE", evidence: "INV-C-7" });
  });

  it("a refresh keeps entered costs and takes today's stock", async () => {
    await adjustVariantStock(v.A!.id, 2, "RESTOCK", OWNER.type === "ADMIN" ? OWNER.adminId : "", "found two"); // costing is off: no valuation
    await draftCutover({}, OWNER);
    expect(await line("A")).toMatchObject({ draftQuantity: 10 });
    expect(await line("C")).toMatchObject({ valuationStatus: "KNOWN", evidence: "INV-C-7" });
  });

  it("is OWNER-only over HTTP and lists lines with filters", async () => {
    const owner = await asOwner();
    const res = await owner.get("/api/v1/finance/inventory-cutover");
    expect(res.status).toBe(200);
    expect(res.body.prerequisites).toMatchObject({ openingDateSet: true, openingBalancesPosted: true, costingActive: false });
    expect(res.body.preview.inTransit).toBeGreaterThanOrEqual(240);
    // its own line (by SKU), not the first page of the whole store: a long-lived test database holds hundreds
    const { sku } = await prisma.productVariant.findUniqueOrThrow({ where: { id: v.B!.id }, select: { sku: true } });
    const missing = await listCutoverLines({ status: "MISSING", search: sku, page: 1, pageSize: 200 });
    expect(missing.lines.map((l) => l.variantId)).toContain(v.B!.id);
  });
});

describe("approval", () => {
  it("an opening-balance error larger than the true-up is refused at post, leaving nothing behind", async () => {
    await updateCutoverSettings({ openingErrorAmount: 1_000_000_000, openingErrorReason: "test: too large" }, OWNER);
    await approveCutover({ acknowledgeMissing: true }, OWNER);
    await expect(postCutover(OWNER)).rejects.toMatchObject({ statusCode: 409 });
    const after = await getCutover();
    expect(after.batch!.status).toBe("APPROVED");
    expect(after.costingActivatedAt).toBeNull();
    expect(await prisma.inventoryValuationEntry.count()).toBe(0);
    await reopenCutover({ reason: "fix the opening error" }, OWNER);
  });

  it("missing costs must be acknowledged; an approved cutover's lines are frozen (service and database)", async () => {
    const preview = (await getCutover()).preview!;
    expect(preview.adjustment).toBeGreaterThan(0);
    await updateCutoverSettings({ openingErrorAmount: Math.floor(preview.adjustment / 2), openingErrorReason: "Opening count missed a carton of A" }, OWNER);
    await expect(approveCutover({ acknowledgeMissing: false }, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    const { batch } = await approveCutover({ acknowledgeMissing: true }, OWNER);
    expect(batch.status).toBe("APPROVED");
    await expect(updateCutoverLines([{ variantId: v.C!.id, unitCost: 60, valuationStatus: "ESTIMATED", costSource: "OWNER" }], OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await expect(prisma.inventoryCutoverLine.updateMany({ where: { variantId: v.C!.id }, data: { unitCost: 61 } })).rejects.toThrow(/frozen/);
  });
});

describe("post", () => {
  let expectedOpeningError = 0;

  it("posts once under concurrency: first valuations at the stock at post, one true-up journal, costing activated", async () => {
    await product("D", 4, { productCost: 30 }); // created after approval: added at post as MISSING
    expectedOpeningError = Number((await prisma.inventoryCutoverBatch.findFirstOrThrow()).openingErrorAmount);
    const results = await Promise.all([postCutover(OWNER), postCutover(OWNER)]);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    const posted = results.find((r) => !r.replayed)!;
    expect(results.find((r) => r.replayed)!.batch.journalEntryId).toBe(posted.batch.journalEntryId);
    expect(posted.batch.status).toBe("POSTED");

    const entry = async (name: string) => prisma.inventoryValuationEntry.findFirstOrThrow({ where: { variantId: v[name]!.id } });
    expect(await entry("A")).toMatchObject({ kind: "CUTOVER", qtyChange: 10, valuationStatus: "KNOWN" });
    expect(Number((await entry("A")).valueChange)).toBe(1000);
    expect(await entry("B")).toMatchObject({ kind: "CUTOVER", qtyChange: 5, valuationStatus: "MISSING", unvaluedAfter: 5 });
    expect(await entry("C")).toMatchObject({ kind: "CUTOVER", qtyChange: 0 });
    expect(await entry("D")).toMatchObject({ kind: "CUTOVER", qtyChange: 4, valuationStatus: "MISSING" });
    expect(await line("D")).toMatchObject({ costSource: "ADDED_AT_POST", postedQuantity: 4 });
    expect(await prisma.inventoryCostState.count({ where: { variantId: v.U!.id } })).toBe(0);

    const s = posted.batch.summary as { adjustment: number; valuation: number; inTransit: number; ledgerBefore: number; toOpeningBalanceEquity: number; toCostAdjustments: number };
    expect(s.ledgerBefore).toBe(1000);
    expect(s.adjustment).toBeCloseTo(s.valuation + s.inTransit - s.ledgerBefore, 2);
    expect(s.toOpeningBalanceEquity).toBe(expectedOpeningError);
    const journal = posted.journal!;
    expect(journal.kind).toBe("ADJUSTMENT");
    const accountOf = async (key: string) => (await prisma.accountMapping.findFirstOrThrow({ where: { key } })).accountId;
    const [inventory, equity, adjustments] = await Promise.all([accountOf("asset.inventory"), accountOf("equity.opening_balance"), accountOf("cogs.cost_adjustments")]);
    const on = (accountId: string) => journal.lines.find((l) => l.accountId === accountId);
    expect(on(inventory)!.debit).toBeCloseTo(s.adjustment, 2);
    expect(on(equity)!.credit).toBeCloseTo(expectedOpeningError, 2);
    expect(on(adjustments)!.credit).toBeCloseTo(s.adjustment - expectedOpeningError, 2);
    expect(s.toCostAdjustments).toBeCloseTo(s.adjustment - expectedOpeningError, 2);
    expect((await getCutover()).costingActivatedAt).not.toBeNull();
  });

  it("establishes inventory account = valuation + in-transit, and every costing check MATCHES", async () => {
    await postPending();
    const r = await checks(["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity"]);
    for (const [key, run] of Object.entries(r)) expect(run.status, key).toBe("MATCHED");
  });

  it("after the cutover: sales cost at the average; cancelling an in-transit order moves value from in-transit back into stock", async () => {
    const o = await placeOrder([{ variantId: v.A!.id, quantity: 1 }]);
    const [sold] = await prisma.orderItem.findMany({ where: { orderId: o.id }, select: { unitCostSnapshot: true, unitCostSource: true } });
    expect(sold).toMatchObject({ unitCostSnapshot: 10_000, unitCostSource: "INVENTORY" }); // 100.00 in minor units
    const { business } = await getFinanceContext();
    const before = await inventoryLedgerBridge(prisma, business);
    await updateOrderStatus(inTransitOrderId, { status: "CANCELLED" }, OWNER.type === "ADMIN" ? OWNER.adminId : "");
    await postPending();
    const after = await inventoryLedgerBridge(prisma, business);
    expect(after.inTransitMinor - before.inTransitMinor).toBe(-24_000);
    expect(after.valuationMinor - before.valuationMinor).toBe(24_000); // back at the line's own cost (120 × 2)
    const r = await checks(["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation"]);
    expect([r["inventory.valuation_vs_ledger"]!.status, r["inventory.quantity_vs_valuation"]!.status]).toEqual(["MATCHED", "MATCHED"]);
  });

  it("is final: a repeat post replays, nothing can be drafted or edited, and the database refuses changes", async () => {
    const again = await postCutover(OWNER);
    expect(again.replayed).toBe(true);
    await expect(draftCutover({}, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await expect(reopenCutover({ reason: "undo" }, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    await expect(prisma.inventoryCutoverBatch.updateMany({ where: { status: "POSTED" }, data: { notes: "edited" } })).rejects.toThrow(/immutable/);
    await expect(prisma.inventoryCutoverLine.deleteMany({ where: { variantId: v.C!.id } })).rejects.toThrow(/immutable/);
    // A cut-over variant can't be hard-deleted: the posted line (and its valuation history) protect it.
    await expect(prisma.productVariant.delete({ where: { id: v.C!.id } })).rejects.toThrow();
  });
});
