/**
 * Automatic cost estimates (blueprint P0.2; owner decisions Q3 = A and Q-D, 27 Oct 2026). Under the AUTO_ESTIMATE cost
 * policy, a sold line with no recorded cost is booked at an estimate taken from the FIRST source that exists:
 *
 *   1. the variant's book average cost (InventoryCostState.avgUnitCost);
 *   2. its latest APPROVED recipe, at the materials' book averages (every material needs one);
 *   3. the unit cost of its latest POSTED goods receipt;
 *   4. its catalog cost (ProductVariant.costPrice ?? Product.costPrice).
 *
 * When none exists no estimate is made: the line stays "cost missing" (Q1, Q3). The estimate is labelled ESTIMATED in the
 * books and on screen, and waits for the owner to confirm it. KNOWN_ONLY and APPROVED_ESTIMATES stores never reach this.
 *
 * The same chain decides the publishing guard: with costing live and AUTO_ESTIMATE, a product published for the first time
 * must have a cost source for every active variant — never applied to a product that was already published.
 */
import { minorDigits } from "@clothing-brand/shared";
import { Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";

type Db = AppTransactionClient | typeof prisma;
import { recipeStandardCosts, type RecipeCostLine } from "./costing.service";
import { loadCostingState } from "./cost-resolver";

export type EstimateSource = "BOOK_AVERAGE" | "RECIPE" | "LAST_PURCHASE" | "CATALOG";
export interface CostEstimate {
  unitCostMinor: number;
  source: EstimateSource;
}

export const ESTIMATE_SOURCE_LABEL: Record<EstimateSource, string> = {
  BOOK_AVERAGE: "book average cost",
  RECIPE: "approved recipe at today's material costs",
  LAST_PURCHASE: "last posted purchase",
  CATALOG: "catalog cost price",
};

const toMinor = (major: Prisma.Decimal | { toString(): string }, currency: string) =>
  new Prisma.Decimal(major.toString()).mul(new Prisma.Decimal(10).pow(minorDigits(currency))).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_EVEN).toNumber();

/** Recipe lines of each variant's product's latest APPROVED bill of materials (lines the business supplies). */
async function approvedRecipeLines(db: Db, variantIds: string[]): Promise<RecipeCostLine[]> {
  if (!variantIds.length) return [];
  return db.$queryRaw<RecipeCostLine[]>`
    SELECT v.id AS "variantId", l."materialVariantId", l."qtyPerUnit", l."wastagePct"
    FROM "ProductVariant" v
    JOIN LATERAL (SELECT b.id FROM "BillOfMaterials" b WHERE b."productId" = v."productId" AND b.status = 'APPROVED' ORDER BY b.version DESC LIMIT 1) b ON TRUE
    JOIN "BillOfMaterialsLine" l ON l."bomId" = b.id AND l."suppliedBy" = 'BUSINESS' AND (l."finishedVariantId" IS NULL OR l."finishedVariantId" = v.id)
    WHERE v.id IN (${Prisma.join(variantIds)})`;
}

/** The Q-D chain for each variant; a variant with no source is absent from the map. Read-only. */
export async function estimateUnitCosts(variantIds: string[], currency: string, db: Db = prisma): Promise<Map<string, CostEstimate>> {
  const ids = [...new Set(variantIds)];
  const out = new Map<string, CostEstimate>();
  if (!ids.length) return out;

  const states = await db.inventoryCostState.findMany({ where: { variantId: { in: ids }, avgUnitCost: { not: null } }, select: { variantId: true, avgUnitCost: true } });
  for (const s of states) out.set(s.variantId, { unitCostMinor: toMinor(s.avgUnitCost!, currency), source: "BOOK_AVERAGE" });

  let left = ids.filter((id) => !out.has(id));
  const lines = await approvedRecipeLines(db, left);
  if (lines.length) {
    const mats = await db.inventoryCostState.findMany({ where: { variantId: { in: [...new Set(lines.map((l) => l.materialVariantId))] } }, select: { variantId: true, avgUnitCost: true } });
    const avg = new Map(mats.map((m) => [m.variantId, m.avgUnitCost]));
    for (const [id, minor] of recipeStandardCosts(lines, (m) => avg.get(m) ?? null, currency)) if (minor !== null && minor > 0) out.set(id, { unitCostMinor: minor, source: "RECIPE" });
  }

  left = ids.filter((id) => !out.has(id));
  if (left.length) {
    const receipts = await db.goodsReceiptLine.findMany({
      where: { variantId: { in: left }, qtyAccepted: { gt: 0 }, goodsReceipt: { status: "POSTED" } },
      orderBy: [{ goodsReceipt: { receiptDate: "desc" } }, { goodsReceipt: { postedAt: "desc" } }],
      select: { variantId: true, unitCost: true },
    });
    for (const r of receipts) if (!out.has(r.variantId) && toMinor(r.unitCost, currency) > 0) out.set(r.variantId, { unitCostMinor: toMinor(r.unitCost, currency), source: "LAST_PURCHASE" });
  }

  left = ids.filter((id) => !out.has(id));
  if (left.length) {
    const variants = await db.productVariant.findMany({ where: { id: { in: left } }, select: { id: true, costPrice: true, product: { select: { costPrice: true } } } });
    for (const v of variants) {
      const c = v.costPrice ?? v.product.costPrice;
      if (c !== null && toMinor(c, currency) > 0) out.set(v.id, { unitCostMinor: toMinor(c, currency), source: "CATALOG" });
    }
  }
  return out;
}

/**
 * The publishing guard (Q3 = A): the SKUs of a product's active variants that would sell with no cost at all. Empty unless
 * costing is live and the store's policy is AUTO_ESTIMATE, the product is stock-tracked, and it is being published for the
 * first time (from DRAFT or READY — an UNPUBLISHED product was published before and is never held back).
 */
export async function variantsWithoutAnyCost(productId: string, fromStatus: string, currency: string, db: Db = prisma): Promise<string[]> {
  if (fromStatus !== "DRAFT" && fromStatus !== "READY") return [];
  const state = await loadCostingState();
  if (!state.costingLive || state.costPolicy !== "AUTO_ESTIMATE") return [];
  const product = await db.product.findUnique({ where: { id: productId }, select: { trackInventory: true, variants: { where: { isActive: true }, select: { id: true, sku: true } } } });
  if (!product?.trackInventory || !product.variants.length) return [];
  const est = await estimateUnitCosts(product.variants.map((v) => v.id), currency, db);
  return product.variants.filter((v) => !est.has(v.id)).map((v) => v.sku);
}
