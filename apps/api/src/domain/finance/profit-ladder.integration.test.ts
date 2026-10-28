import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS, businessDate } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, markOpeningPostedInTx, ownerId, purgeFinanceTables } from "../../test-fixtures";
import { adjustVariantStock } from "../../modules/inventory/inventory.service";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { activateInventoryCostingInTx, recordValuationInTx } from "./costing.service";
import { processFinancialEvent } from "./events.service";
import { getFinanceContext } from "./finance-context";
import { FULL_VIEW } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { profitByDay, profitReport } from "./profit.service";
import type { FinanceActor } from "./finance-audit";

// Blueprint P2.4 (owner decisions Q2 = A, Q15 = A): the books profit ladder runs from net sales to the income statement's
// net profit, which it equals by construction; stock corrections — shrinkage included — sit on their own line, the same
// rule in the ladder and the daily view, so selling margins are never moved by a write-off.

const SYSTEM: FinanceActor = { type: "SYSTEM", label: "test" };
let OWNER: FinanceActor;
let admin = "";
let variantId = "";
let today = "";

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
  today = businessDate(new Date(), ctx.business.timezone);
  await ensureCommerceAccounting(SYSTEM);
  await financeTransaction(async (tx) => {
    await tx.financeBusiness.update({ where: { id: ctx.business.id }, data: { openingDate: new Date("2026-01-01T00:00:00Z") } });
    await tx.financeAuditEntry.create({ data: { businessId: ctx.business.id, actorType: "SYSTEM", actorLabel: "test", action: "business.update", entityType: "FinanceBusiness", entityId: ctx.business.id } });
    await markOpeningPostedInTx(tx, ctx.business.id, new Date("2026-01-01T00:00:00Z"));
  });
  const p = await createStockedProduct({ stocks: [10], basePrice: 1000 });
  variantId = p.variants[0]!.id;
  await financeTransaction(async (tx) => {
    await recordValuationInTx(tx, { business: ctx.business, brandId: ctx.brand.id, variantId, sourceType: "Cutover", sourceId: "test", financialDate: today, op: { type: "CUTOVER", qty: 10, valueMinor: 10 * 10_000 } });
    await activateInventoryCostingInTx(tx, ctx.business.id, new Date(Date.now() - 60_000), SYSTEM);
  });
  await postPending();
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("the books profit ladder", () => {
  it("damaged stock written off is a stock correction, not cost of goods — in the daily view and the ladder alike", async () => {
    const before = await profitByDay({ from: today, to: today });
    await adjustVariantStock(variantId, -2, "DAMAGED", admin, "water damage");
    await postPending();
    const after = await profitByDay({ from: today, to: today });
    expect(after.totals.goods).toBeCloseTo(before.totals.goods, 2);
    expect(after.totals.stockCorrections - before.totals.stockCorrections).toBeCloseTo(200, 2); // 2 × ৳100
    expect(after.totals.salesProfit).toBeCloseTo(before.totals.salesProfit, 2);

    const r = await profitReport({ from: today, to: today }, FULL_VIEW);
    expect(r.totals.stockCorrections).toBeCloseTo(after.totals.stockCorrections, 2);
    expect(r.ladder.find((s) => s.key === "stockCorrections")!.amount).toBeCloseTo(-after.totals.stockCorrections, 2);
  });

  it("every step adds up to the income statement's net profit; the subtotals are what they say", async () => {
    const r = await profitReport({ from: today, to: today }, FULL_VIEW);
    const step = (k: string) => r.ladder.find((s) => s.key === k)!.amount;
    const steps = r.ladder.filter((s) => !("subtotal" in s && s.subtotal));
    expect(steps.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(r.totals.netProfit, 2);
    expect(step("netProfit")).toBeCloseTo(r.totals.netProfit, 2);
    expect(step("grossMargin")).toBeCloseTo(step("netSales") + step("goods"), 2);
    expect(step("contribution")).toBeCloseTo(step("grossMargin") + step("packaging") + step("delivery") + step("paymentFees") + step("ads"), 2);
    expect(r.completeness).toMatchObject({ missingCostLines: expect.any(Number), estimatedCostLines: expect.any(Number), monthStatus: null });
  });
});
