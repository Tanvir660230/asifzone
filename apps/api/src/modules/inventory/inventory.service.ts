import type { StockMovementListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";

const include = {
  variant: { select: { sku: true, size: true, color: true, product: { select: { id: true, name: true, slug: true } } } },
  admin: { select: { name: true } },
};

/** Central, reusable stock-write primitive — every manual/admin-initiated stock change funnels
 * through this so the conditional-guard + StockMovement-row discipline order.service.ts already
 * uses for checkout/cancel/delete/return is never duplicated or drifted from. */
export async function adjustVariantStock(
  variantId: string,
  delta: number,
  reason: "ADJUSTMENT" | "RESTOCK",
  adminId: string,
  note?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    // `stock: { gte: -delta }` is a no-op guard when delta >= 0 (increasing can never go negative);
    // when delta < 0, it requires current stock to already cover the decrease, the same conditional-
    // update pattern checkout's decrement uses — never trust a plain unconditional update for a
    // decrease.
    const result = await tx.productVariant.updateMany({
      where: { id: variantId, stock: { gte: -delta } },
      data: { stock: { increment: delta } },
    });
    if (result.count === 0) throw AppError.conflict("Stock cannot go below zero");

    await tx.stockMovement.create({ data: { variantId, change: delta, reason, adminId, note: note ?? null } });
    return tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  });
}

export async function listStockMovements(query: StockMovementListQuery) {
  const where = {
    ...(query.variantId ? { variantId: query.variantId } : {}),
    ...(query.productId ? { variant: { productId: query.productId } } : {}),
    ...(query.reason ? { reason: query.reason } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  return paginate(
    query,
    (p) => prisma.stockMovement.findMany({ where, include, orderBy: { createdAt: "desc" }, ...p }),
    () => prisma.stockMovement.count({ where }),
  );
}

/** Read-only drift report — flags any variant where sum(StockMovement.change) doesn't match the
 * current stock number. Deliberately never auto-corrects: a silent fix would itself be an
 * unexplained ledger gap, exactly what this feature exists to prevent. Admins reconcile through
 * `adjustVariantStock`, which always requires a reason and leaves its own row. */
export async function getStockDiscrepancies() {
  // Explicit ::int casts — Postgres SUM() over an int column returns bigint, which the pg driver
  // hands back as a JS BigInt that JSON.stringify can't serialize; casting keeps this a plain number.
  return prisma.$queryRaw<
    Array<{ variantId: string; sku: string; productName: string; currentStock: number; ledgerSum: number }>
  >`
    SELECT v.id AS "variantId", v.sku, p.name AS "productName", v.stock AS "currentStock", COALESCE(SUM(sm.change), 0)::int AS "ledgerSum"
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "StockMovement" sm ON sm."variantId" = v.id
    GROUP BY v.id, v.sku, p.name, v.stock
    HAVING v.stock <> COALESCE(SUM(sm.change), 0)
    ORDER BY p.name
    LIMIT 500
  `;
}
