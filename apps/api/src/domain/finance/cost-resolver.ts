/**
 * The one answer to "what does a unit of this variant cost?" for every screen that shows a held or sold unit's cost —
 * stock value, dead stock, cost sheet, product page (blueprint P-1; owner decision Q1 = A, 27 Oct 2026):
 *
 *   costing live + the variant has a book average      → BOOK         the moving-average book cost
 *   costing live, fill-to-order, an approved recipe     → PROVISIONAL  the recipe standard cost at the materials' averages
 *   costing live, nothing above, policy allows estimates → ESTIMATED   the catalog cost, labelled an estimate
 *   costing not live                                     → CATALOG     ProductVariant.costPrice ?? Product.costPrice
 *   no source at all                                     → MISSING     no number; profit and margin are unavailable
 *
 * A missing cost is never 0. Read-only: the ledger, posted entries and order-line snapshots are untouched, and the
 * pre-books launch report keeps its own catalog estimate (profit.service.ts).
 */
import { minorDigits } from "@clothing-brand/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { activeCostingInTx, fillToOrderRecipeLines, recipeStandardCosts } from "./costing.service";
import { FINANCE_BUSINESS_KEY } from "./finance-context";

export type CostBasis = "BOOK" | "PROVISIONAL" | "ESTIMATED" | "CATALOG" | "MISSING";

export interface ResolvedCost {
  /** Minor units; null exactly when `basis` is MISSING. */
  unitCostMinor: number | null;
  basis: CostBasis;
}

export interface CostFacts {
  costingLive: boolean;
  /** The store's FinanceBusiness.costPolicy; KNOWN_ONLY never turns a catalog cost into an estimate. */
  costPolicy: "KNOWN_ONLY" | "APPROVED_ESTIMATES";
  bookAvgMinor: number | null;
  recipeMinor: number | null;
  catalogMinor: number | null;
}

export const MISSING_COST: ResolvedCost = { unitCostMinor: null, basis: "MISSING" };

/** The P-1 table. Pure. */
export function resolveUnitCost(f: CostFacts): ResolvedCost {
  if (!f.costingLive) return f.catalogMinor === null ? MISSING_COST : { unitCostMinor: f.catalogMinor, basis: "CATALOG" };
  if (f.bookAvgMinor !== null) return { unitCostMinor: f.bookAvgMinor, basis: "BOOK" };
  if (f.recipeMinor !== null) return { unitCostMinor: f.recipeMinor, basis: "PROVISIONAL" };
  if (f.costPolicy !== "KNOWN_ONLY" && f.catalogMinor !== null) return { unitCostMinor: f.catalogMinor, basis: "ESTIMATED" };
  return MISSING_COST;
}

const toMinorHalfEven = (major: Prisma.Decimal | { toString(): string }, currency: string) =>
  new Prisma.Decimal(major.toString()).mul(new Prisma.Decimal(10).pow(minorDigits(currency))).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_EVEN).toNumber();

/** The store's costing state: whether costing is live for this installation's books, and its cost policy. */
export async function loadCostingState(): Promise<Pick<CostFacts, "costingLive" | "costPolicy">> {
  const [scope, business] = await Promise.all([
    // a plain read (no lock), the same rule the stock movements use
    activeCostingInTx(prisma as unknown as Parameters<typeof activeCostingInTx>[0]),
    prisma.financeBusiness.findUnique({ where: { key: FINANCE_BUSINESS_KEY }, select: { costPolicy: true } }),
  ]);
  return { costingLive: scope !== null, costPolicy: business?.costPolicy ?? "KNOWN_ONLY" };
}

export interface VariantCostInput {
  id: string;
  costPrice: Prisma.Decimal | null;
  product: { costPrice: Prisma.Decimal | null };
}

/** Resolves every given variant's unit cost in a few reads (no per-variant queries). */
export async function resolveVariantCosts(variants: VariantCostInput[], currency: string): Promise<Map<string, ResolvedCost>> {
  const state = await loadCostingState();
  const ids = variants.map((v) => v.id);
  const book = new Map<string, number>();
  const recipe = new Map<string, number | null>();
  if (state.costingLive && ids.length) {
    const states = await prisma.inventoryCostState.findMany({ where: { variantId: { in: ids }, avgUnitCost: { not: null } }, select: { variantId: true, avgUnitCost: true } });
    for (const s of states) book.set(s.variantId, toMinorHalfEven(s.avgUnitCost!, currency));
    const lines = await fillToOrderRecipeLines(prisma, ids.filter((id) => !book.has(id)));
    if (lines.length) {
      const mats = await prisma.inventoryCostState.findMany({ where: { variantId: { in: [...new Set(lines.map((l) => l.materialVariantId))] } }, select: { variantId: true, avgUnitCost: true } });
      const avg = new Map(mats.map((m) => [m.variantId, m.avgUnitCost]));
      for (const [id, minor] of recipeStandardCosts(lines, (m) => avg.get(m) ?? null, currency)) recipe.set(id, minor);
    }
  }
  const out = new Map<string, ResolvedCost>();
  for (const v of variants) {
    const catalog = v.costPrice ?? v.product.costPrice;
    out.set(
      v.id,
      resolveUnitCost({
        ...state,
        bookAvgMinor: book.get(v.id) ?? null,
        recipeMinor: recipe.get(v.id) ?? null,
        catalogMinor: catalog === null ? null : toMinorHalfEven(catalog, currency),
      }),
    );
  }
  return out;
}
