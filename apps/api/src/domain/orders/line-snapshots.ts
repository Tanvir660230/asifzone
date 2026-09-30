/**
 * Historical order-line facts (Phase 6, docs/PHASE_6_AUDIT.md) — the ONE writer of OrderItem's cost and attribution
 * snapshots. Called inside the transaction that writes the order line (order creation, exchange-replacement creation),
 * so the values are exactly what the catalog said when the line became financially committed. Nothing updates them
 * afterwards, and no report reconstructs them from today's catalog.
 */
import { fromMajor } from "@clothing-brand/shared";
import type { AppTransactionClient } from "../../config/prisma";

export interface LineSnapshot {
  /** Minor units of the store currency; null = no cost configured (unknown — never 0 by default). */
  unitCostSnapshot: number | null;
  productIdSnapshot: string;
  categoryIdSnapshot: string;
  categoryNameSnapshot: string;
  /** Free-text brand at order time; null = unbranded. */
  brandSnapshot: string | null;
}

export async function captureLineSnapshots(tx: AppTransactionClient, variantIds: string[], currency: string): Promise<Map<string, LineSnapshot>> {
  const rows = await tx.productVariant.findMany({
    where: { id: { in: [...new Set(variantIds)] } },
    select: {
      id: true,
      costPrice: true,
      product: { select: { id: true, costPrice: true, brand: true, categoryId: true, category: { select: { name: true } } } },
    },
  });
  const out = new Map<string, LineSnapshot>();
  for (const v of rows) {
    const cost = v.costPrice ?? v.product.costPrice;
    const brand = v.product.brand?.trim();
    out.set(v.id, {
      unitCostSnapshot: cost === null ? null : fromMajor(cost.toString(), currency).amount,
      productIdSnapshot: v.product.id,
      categoryIdSnapshot: v.product.categoryId,
      categoryNameSnapshot: v.product.category.name,
      brandSnapshot: brand ? brand : null,
    });
  }
  return out;
}

/** The snapshot columns for one line (all null when the variant no longer exists — nothing is invented). */
export function lineSnapshotData(snapshots: Map<string, LineSnapshot>, variantId: string) {
  const s = snapshots.get(variantId);
  return {
    unitCostSnapshot: s?.unitCostSnapshot ?? null,
    productIdSnapshot: s?.productIdSnapshot ?? null,
    categoryIdSnapshot: s?.categoryIdSnapshot ?? null,
    categoryNameSnapshot: s?.categoryNameSnapshot ?? null,
    brandSnapshot: s?.brandSnapshot ?? null,
  };
}
