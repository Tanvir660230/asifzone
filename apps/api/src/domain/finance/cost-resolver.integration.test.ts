import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, markOpeningPostedInTx, purgeFinanceTables } from "../../test-fixtures";
import { computeMetrics } from "../metrics/metrics.service";
import { loadInventoryFacts } from "../metrics/facts.repository";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { activateInventoryCostingInTx, recordValuationInTx } from "./costing.service";
import { resolveVariantCosts } from "./cost-resolver";
import { setCostPolicy } from "./chart.service";
import { getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import type { FinanceActor } from "./finance-audit";

// Blueprint P-1 (owner decision Q1 = A) against the real database: catalog cost before costing goes live, the book average
// after, "cost missing" — never 0 — where no source exists, and the inventory value metric leaves missing costs out.

const SYSTEM: FinanceActor = { type: "SYSTEM", label: "test" };
const v: Record<string, string> = {};

async function variant(name: string, stock: number, catalogCost: number | null) {
  const p = await createStockedProduct({ stocks: [stock], basePrice: 1000 });
  await prisma.product.update({ where: { id: p.product.id }, data: { costPrice: catalogCost } });
  v[name] = p.variants[0]!.id;
}
const resolved = async (name: string) => {
  const rows = await prisma.productVariant.findMany({ where: { id: v[name]! }, select: { id: true, costPrice: true, product: { select: { costPrice: true } } } });
  return (await resolveVariantCosts(rows, "BDT")).get(v[name]!);
};

beforeAll(async () => {
  await purgeFinanceTables();
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(SYSTEM);
  await financeTransaction(async (tx) => {
    await tx.financeBusiness.update({ where: { id: ctx.business.id }, data: { openingDate: new Date("2026-01-01T00:00:00Z"), costPolicy: "KNOWN_ONLY" } });
    await tx.financeAuditEntry.create({ data: { businessId: ctx.business.id, actorType: "SYSTEM", actorLabel: "test", action: "business.update", entityType: "FinanceBusiness", entityId: ctx.business.id } });
    await markOpeningPostedInTx(tx, ctx.business.id, new Date("2026-01-01T00:00:00Z"));
  });
  await variant("valued", 10, 999);
  await variant("catalogOnly", 4, 200);
  await variant("noCost", 3, null);
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("cost resolver against the database", () => {
  it("before costing goes live: catalog cost, and missing where there is none", async () => {
    expect(await resolved("valued")).toEqual({ unitCostMinor: 99_900, basis: "CATALOG" });
    expect(await resolved("noCost")).toEqual({ unitCostMinor: null, basis: "MISSING" });
    const facts = await loadInventoryFacts("BDT");
    expect(facts.find((f) => f.variantId === v.noCost)).toMatchObject({ currentUnitCost: null, costBasis: "MISSING" });
  });

  it("the inventory value metric leaves a missing cost out and reports it as coverage", async () => {
    const before = await computeMetrics({ metrics: ["inventory_value"], range: { preset: "today" }, fresh: true });
    expect(before.metrics.inventory_value!.coverage!.missing).toBeGreaterThanOrEqual(1);
  });

  it("once costing is live: the book average for a valued variant, the policy decides for one without a position", async () => {
    const ctx = await getFinanceContext();
    await financeTransaction(async (tx) => {
      await recordValuationInTx(tx, { business: ctx.business, brandId: ctx.brand.id, variantId: v.valued!, sourceType: "Cutover", sourceId: "test", financialDate: "2026-10-15", op: { type: "CUTOVER", qty: 10, valueMinor: 10 * 12_000 } });
      await activateInventoryCostingInTx(tx, ctx.business.id, new Date(), SYSTEM);
    });
    expect(await resolved("valued")).toEqual({ unitCostMinor: 12_000, basis: "BOOK" });
    // KNOWN_ONLY: a catalog cost is not a book cost — missing until the item is valued
    expect(await resolved("catalogOnly")).toEqual({ unitCostMinor: null, basis: "MISSING" });
    await setCostPolicy({ costPolicy: "APPROVED_ESTIMATES", reason: "test: estimates allowed" }, SYSTEM);
    expect(await resolved("catalogOnly")).toEqual({ unitCostMinor: 20_000, basis: "ESTIMATED" });
    const facts = await loadInventoryFacts("BDT");
    expect(facts.find((f) => f.variantId === v.valued)).toMatchObject({ currentUnitCost: 12_000, costBasis: "BOOK" });
  });
});
