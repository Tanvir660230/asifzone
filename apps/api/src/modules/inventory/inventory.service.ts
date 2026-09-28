import { Prisma } from "@prisma/client";
import type { ManualStockReason, StockMovementListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { notifyBackInStock } from "../stock-alerts/stock-alert.service";

/** The ONLY application code allowed to change `ProductVariant.stock` or write `StockMovement` rows
 * (docs/INVENTORY_INVARIANTS.md; enforced by inventory-writer.guard.test.ts). Every change is a relative,
 * guarded update written in the same transaction as its ledger row, so `stock = Σ movements` holds. Order-
 * linked releases are idempotent per order line through `OrderItem.restockedQuantity`. */

type Tx = Prisma.TransactionClient;

interface Actor {
  adminId?: string | null;
  note?: string | null;
}

const include = {
  variant: { select: { sku: true, size: true, color: true, product: { select: { id: true, name: true, slug: true } } } },
  admin: { select: { name: true } },
};

/** Applies `delta` to one variant's stock and returns the new balance — or null when the variant no longer
 * exists, or when `guard` is set and a decrease would take stock below zero. Raw SQL so the new value comes
 * back from the same atomic statement (needed to spot a 0 → positive "back in stock" crossing). */
async function applyDelta(tx: Tx, variantId: string, delta: number, guard: boolean): Promise<number | null> {
  const rows = guard
    ? await tx.$queryRaw<Array<{ stock: number }>>`
        UPDATE "ProductVariant" SET stock = stock + ${delta}, "updatedAt" = NOW()
        WHERE id = ${variantId} AND stock + ${delta} >= 0
        RETURNING stock`
    : await tx.$queryRaw<Array<{ stock: number }>>`
        UPDATE "ProductVariant" SET stock = stock + ${delta}, "updatedAt" = NOW()
        WHERE id = ${variantId}
        RETURNING stock`;
  return rows[0]?.stock ?? null;
}

/** Row-locked read of a variant's current stock (null if it doesn't exist). */
async function lockStock(tx: Tx, variantId: string): Promise<number | null> {
  const rows = await tx.$queryRaw<Array<{ stock: number }>>`SELECT stock FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
  return rows[0]?.stock ?? null;
}

type MovementReason = Prisma.StockMovementCreateManyInput["reason"];

function movement(variantId: string, change: number, reason: MovementReason, actor: Actor, orderId?: string | null) {
  return { variantId, change, reason, orderId: orderId ?? null, adminId: actor.adminId ?? null, note: actor.note ?? null };
}

/** Fire-and-forget back-in-stock emails for variants that just went from 0 to positive. Call after commit. */
export function notifyReplenished(variantIds: string[]): void {
  for (const id of new Set(variantIds)) {
    notifyBackInStock(id).catch((err) => console.error("[stock-alert] notify failed:", err));
  }
}

// --- order-driven movements ---------------------------------------------------------------------

export interface SaleResult {
  /** Variants that didn't have enough stock (only possible with allowOversell — otherwise this throws). */
  oversold: string[];
  /** New stock per variant after the sale, for low-stock checks. */
  stockAfter: Map<string, number>;
}

/** Takes an order's units out of stock (`ORDER` movements). Without `allowOversell`, any line short of stock
 * aborts the whole transaction with a 409; with it (a paid gateway settlement only), stock may go negative. */
export async function recordSale(
  tx: Tx,
  orderId: string,
  items: Array<{ variantId: string; quantity: number }>,
  opts: { allowOversell?: boolean } & Actor = {},
): Promise<SaleResult> {
  const oversold: string[] = [];
  const stockAfter = new Map<string, number>();
  // Distinct variant rows are independent — run the guarded decrements concurrently (checkout latency).
  const results = await Promise.all(items.map((item) => applyDelta(tx, item.variantId, -item.quantity, true)));
  for (const [i, item] of items.entries()) {
    let after = results[i];
    if (after === null || after === undefined) {
      if (!opts.allowOversell) throw AppError.conflict("Stock changed while placing your order — please review your cart");
      after = await applyDelta(tx, item.variantId, -item.quantity, false);
      if (after === null) throw AppError.conflict("An item in this order no longer exists");
      oversold.push(item.variantId);
    }
    stockAfter.set(item.variantId, after);
  }
  await tx.stockMovement.createMany({ data: items.map((item) => movement(item.variantId, -item.quantity, "ORDER", opts, orderId)) });
  return { oversold, stockAfter };
}

export interface ReleasedLine {
  orderItemId: string;
  variantId: string;
  quantity: number;
}

/** Puts an order's units back into stock — `release` for a cancellation or trash (`CANCELLATION`), `return` when
 * the customer sent them back (`RETURN`, also counted in `returnedQuantity`). Never releases more than
 * `quantity - restockedQuantity` for a line, so calling it again for the same order puts nothing back.
 * `lines` limits it to specific order lines/quantities (partial delivery, exchange); omitted = everything
 * still outstanding. Returns what was actually released plus the variants that came back into stock. */
export async function releaseOrderLines(
  tx: Tx,
  orderId: string,
  kind: "release" | "return",
  opts: Actor & { lines?: Array<{ orderItemId: string; quantity: number }> } = {},
): Promise<{ released: ReleasedLine[]; replenished: string[] }> {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, variantId: true, quantity: true, restockedQuantity: true } });
  const requested = opts.lines ? new Map(opts.lines.map((l) => [l.orderItemId, l.quantity])) : null;
  const released: ReleasedLine[] = [];
  const replenished: string[] = [];

  for (const item of items) {
    const outstanding = item.quantity - item.restockedQuantity;
    const wanted = requested ? (requested.get(item.id) ?? 0) : outstanding;
    const amount = Math.min(wanted, outstanding);
    if (amount <= 0) continue;

    // Conditional on the line still having that many units outstanding — a concurrent release of the same line
    // (even outside an order-row lock) matches zero rows here instead of double-counting.
    const claimed = await tx.orderItem.updateMany({
      where: { id: item.id, restockedQuantity: { lte: item.quantity - amount } },
      data: {
        restockedQuantity: { increment: amount },
        ...(kind === "return" ? { returnedQuantity: { increment: amount } } : {}),
      },
    });
    if (claimed.count === 0) continue;

    // The variant may have been hard-deleted since (OrderItem.variantId has no FK): the units then have nowhere
    // to go, but the line is still marked released so no later path retries it.
    const after = await applyDelta(tx, item.variantId, amount, false);
    if (after === null) continue;
    await tx.stockMovement.create({ data: movement(item.variantId, amount, kind === "return" ? "RETURN" : "CANCELLATION", opts, orderId) });
    released.push({ orderItemId: item.id, variantId: item.variantId, quantity: amount });
    if (after - amount <= 0 && after > 0) replenished.push(item.variantId);
  }
  return { released, replenished };
}

/** Restoring a pre-shipment order from Trash takes back the units released when it was trashed. All-or-nothing:
 * if any line's stock has since been sold, nothing changes and a 409 explains why. */
export async function reReserveOrderLines(tx: Tx, orderId: string, actor: Actor = {}): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, variantId: true, restockedQuantity: true, returnedQuantity: true } });
  for (const item of items) {
    const amount = item.restockedQuantity - item.returnedQuantity;
    if (amount <= 0) continue;
    const after = await applyDelta(tx, item.variantId, -amount, true);
    if (after === null) {
      throw AppError.conflict("Not enough stock to restore this order — its items have been sold since it was trashed. Adjust stock first.");
    }
    await tx.orderItem.update({ where: { id: item.id }, data: { restockedQuantity: { decrement: amount } } });
    await tx.stockMovement.create({ data: movement(item.variantId, -amount, "ORDER", actor, orderId) });
  }
}

// --- catalog-driven movements -------------------------------------------------------------------

/** Opening stock for a variant just created with stock 0 (product editor → RESTOCK, CSV import → IMPORT). */
export async function recordInitialStock(tx: Tx, variantId: string, quantity: number, reason: "RESTOCK" | "IMPORT", actor: Actor = {}) {
  if (quantity <= 0) return;
  await applyDelta(tx, variantId, quantity, false);
  await tx.stockMovement.create({ data: movement(variantId, quantity, reason, actor) });
}

/** A product-form stock edit as compare-and-set (docs/INVENTORY_INVARIANTS.md rule 6). `expected` is the value
 * the editor last saw; without it only the current value is accepted. Returns the change applied (0 = none). */
export async function setVariantStockFromForm(tx: Tx, variantId: string, desired: number, expected: number | undefined, actor: Actor = {}): Promise<number> {
  const current = await lockStock(tx, variantId);
  if (current === null) throw AppError.notFound("Variant not found");
  if (desired === current) return 0;
  if (expected !== undefined && desired === expected) return 0; // the admin didn't touch stock — a stale form changes nothing
  if (expected === undefined || expected !== current) {
    throw AppError.conflict(
      `Stock for this variant changed since the form was loaded (now ${current}). Reload the product, or use Inventory → Adjust to add or remove units.`,
    );
  }
  const delta = desired - current;
  await applyDelta(tx, variantId, delta, true);
  await tx.stockMovement.create({ data: movement(variantId, delta, "ADJUSTMENT", actor) });
  return delta;
}

/** A declared count (CSV import): sets stock to `counted` under a row lock and records the difference. */
export async function setVariantStockCount(tx: Tx, variantId: string, counted: number, reason: "IMPORT", actor: Actor = {}): Promise<number> {
  const current = await lockStock(tx, variantId);
  if (current === null) throw AppError.notFound("Variant not found");
  const delta = counted - current;
  if (delta === 0) return 0;
  await applyDelta(tx, variantId, delta, false);
  await tx.stockMovement.create({ data: movement(variantId, delta, reason, actor) });
  return delta;
}

/** A variant removed from its product but kept for its order history: its stock is written off to zero. */
export async function zeroVariantStock(tx: Tx, variantIds: string[], actor: Actor = {}) {
  for (const variantId of variantIds) {
    const current = await lockStock(tx, variantId);
    if (!current) continue;
    await applyDelta(tx, variantId, -current, false);
    await tx.stockMovement.create({ data: movement(variantId, -current, "ADJUSTMENT", actor) });
  }
}

// --- manual adjustments -------------------------------------------------------------------------

/** Admin stock adjustment (Inventory → Adjust). Never below zero; DAMAGED/LOST must reduce stock, RESTOCK must
 * add (validated by adjustStockSchema, re-checked here since this is the authority). */
export async function adjustVariantStock(variantId: string, delta: number, reason: ManualStockReason, adminId: string, note?: string | null) {
  if (delta === 0) throw AppError.badRequest("Delta cannot be zero");
  if ((reason === "DAMAGED" || reason === "LOST") && delta > 0) throw AppError.badRequest("Damaged or lost stock must be a negative change");
  if (reason === "RESTOCK" && delta < 0) throw AppError.badRequest("A restock must add stock");

  const { variant, replenished } = await prisma.$transaction(async (tx) => {
    const after = await applyDelta(tx, variantId, delta, true);
    if (after === null) {
      const exists = await tx.productVariant.count({ where: { id: variantId } });
      throw exists ? AppError.conflict("Stock cannot go below zero") : AppError.notFound("Variant not found");
    }
    await tx.stockMovement.create({ data: movement(variantId, delta, reason, { adminId, note }) });
    return { variant: await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } }), replenished: after - delta <= 0 && after > 0 };
  });
  if (replenished) notifyReplenished([variantId]);
  return variant;
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
