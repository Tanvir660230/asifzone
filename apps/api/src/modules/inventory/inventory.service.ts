import { Prisma } from "@prisma/client";
import type { ManualStockReason, StockMovementListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { notifyBackInStock } from "../stock-alerts/stock-alert.service";
import { captureError } from "../../lib/observability/error-capture";
import { randomUUID } from "node:crypto";
import { refreshProductsUsingMaterials } from "../../domain/storefront/read-model.service";
import { fillCapacityChanged, fillMoved, fillToOrderFloorsFor } from "../../domain/stock/fill-capacity.service";
import { activeCostingInTx, valueStockMovementsInTx, type CostingScope, type MovementToValue, type StoredPosition, type VariantCosting } from "../../domain/finance/costing.service";

/** The ONLY application code allowed to change `ProductVariant.stock` or write `StockMovement` rows
 * (docs/INVENTORY_INVARIANTS.md; enforced by inventory-writer.guard.test.ts). Every change is a relative,
 * guarded update written in the same transaction as its ledger row, so `stock = Σ movements` holds. Order-
 * linked releases are idempotent per order line through `OrderItem.restockedQuantity`.
 *
 * Phase 4B (docs/FINANCE_PHASE_4.md §9): quantity stays here; VALUE is the costing service's. Every movement written below
 * is handed, in the same transaction, to costing.service.valueStockMovementsInTx — which values it when its variant is
 * costed (and does nothing otherwise). Order exits carry the unit cost determined at the exit (the order line's snapshot);
 * order releases carry each line's own snapshot; manual changes are valued at the running average. */

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
 * exists, or when `guard` is set and a decrease would take stock below zero (below `-floor` when a floor is given —
 * a fill-to-order variant, docs/STOCK_HUB.md §3). Raw SQL so the new value comes back from the same atomic statement
 * (needed to spot a 0 → positive "back in stock" crossing).
 *
 * `updatedAt` is a `timestamp` without time zone that Prisma reads and writes as UTC. A bare NOW() would store the
 * DB session's local wall clock (Asia/Dhaka, +6 h), so the stamp is taken in UTC — the same semantics as @updatedAt. */
async function applyDelta(tx: Tx, variantId: string, delta: number, guard: boolean, floor = 0): Promise<number | null> {
  const rows = guard
    ? await tx.$queryRaw<Array<{ stock: number }>>`
        UPDATE "ProductVariant" SET stock = stock + ${delta}, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
        WHERE id = ${variantId} AND stock + ${delta} >= ${-floor}
        RETURNING stock`
    : await tx.$queryRaw<Array<{ stock: number }>>`
        UPDATE "ProductVariant" SET stock = stock + ${delta}, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
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

type MovementRow = { id: string; variantId: string; change: number; reason: string; orderId: string | null; createdAt: Date };

/** Hands movements just written to the costing service (same transaction — the stock change and its value are atomic). */
async function value(tx: Tx, items: Array<{ movement: MovementRow; basis: MovementToValue["basis"]; ledger: MovementToValue["ledger"] }>, scope?: CostingScope | null, known?: Map<string, VariantCosting>) {
  return valueStockMovementsInTx(tx, items.map((i) => ({ movement: i.movement, basis: i.basis, ledger: i.ledger })), scope, known);
}

/** Fire-and-forget back-in-stock emails for variants that just went from 0 to positive. Call after commit. */
export function notifyReplenished(variantIds: string[]): void {
  for (const id of new Set(variantIds)) {
    notifyBackInStock(id).catch((err) => captureError(err, { msg: "[stock-alert] notify failed:" }));
  }
}

const refreshing = new Set<Promise<void>>();

/** Fire-and-forget after commit: these variants' stock moved, so the shop's memoised fill capacity is dropped (this
 * process; others within its TTL) and every fill-to-order product whose recipe uses one of them (a material) — or that
 * owns one — is refreshed for the storefront (docs/STOCK_HUB.md §3). One query otherwise. */
export function notifyStockMoved(variantIds: string[]): void {
  if (!variantIds.length) return;
  fillCapacityChanged();
  const run: Promise<void> = refreshProductsUsingMaterials(variantIds)
    .catch((err) => captureError(err, { msg: "[read-model] fill-to-order refresh failed:" }))
    .finally(() => refreshing.delete(run));
  refreshing.add(run);
}

/** Resolves once every refresh `notifyStockMoved` started so far has finished (tests; a graceful shutdown). */
export async function stockMovedSettled(): Promise<void> {
  while (refreshing.size) await Promise.allSettled([...refreshing]);
}

// --- order-driven movements ---------------------------------------------------------------------

export interface SaleResult {
  /** Variants that didn't have enough stock (only possible with allowOversell — otherwise this throws). */
  oversold: string[];
  /** New stock per variant after the sale, for low-stock checks. */
  stockAfter: Map<string, number>;
}

/** Takes an order's units out of stock (`ORDER` movements). Without `allowOversell`, any line short of stock
 * aborts the whole transaction with a 409; with it (a paid gateway settlement only), stock may go negative.
 * D5: a product with trackInventory = false has unlimited availability — its units are still recorded (ledger and
 * balance, for reporting) but never rejected, and never reported as oversold.
 * Fill to order (docs/STOCK_HUB.md §3): a variant in `floors` may go down to `-floor` (ordered, not yet filled) — the
 * caller computes the floors under the materials' locks (fill-capacity.service `fillToOrderFloors`). Its exit is costed
 * like any other: units beyond what is valued become the costing deficit, settled when the bottles are filled. Every caller
 * that can sell such a variant passes them: checkout (insertOrderRecord), order modification (applyPlan, also behind a paid
 * settlement) and exchange (createExchangeOrder); reReserveOrderLines (restore from Trash) does the same for its decrement. */
export async function recordSale(
  tx: Tx,
  orderId: string,
  /** `orderItemIds`: the order lines this exit is for (Phase 4B). For a costed variant the cost is determined under the
   * stock row lock taken by the decrement below and written to exactly these lines with the link to the exit — a costed
   * exit without its lines is refused, so an order can't commit a costed exit whose lines don't carry its cost. */
  items: Array<{ variantId: string; quantity: number; orderItemIds?: string[] }>,
  opts: { allowOversell?: boolean; untrackedVariantIds?: Set<string>; floors?: Map<string, number> } & Actor = {},
): Promise<SaleResult> {
  // Whether costing is active needs no lock: read it before the decrement, so the row lock covers only the stock change and
  // the cost determination that depends on it.
  let scope = await activeCostingInTx(tx);
  // One global lock order: the variants are decremented in id order (as the cutover and fillToOrderFloors lock them), so
  // two carts — or a cart and the cutover — can't deadlock. Each item keeps its own order lines, so the cost movements
  // go to the same lines whatever the order.
  items = [...items].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
  const oversold: string[] = [];
  const stockAfter = new Map<string, number>();
  // Distinct variant rows are independent — run the guarded decrements concurrently (checkout latency).
  const untracked = opts.untrackedVariantIds ?? new Set<string>();
  const results = await Promise.all(items.map((item) => applyDelta(tx, item.variantId, -item.quantity, !untracked.has(item.variantId), opts.floors?.get(item.variantId) ?? 0)));
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
  // Phase 4C: the valuation cutover activates costing while holding every tracked variant's lock. A sale that read "off"
  // above and then waited on that lock must see the switch now (read after the lock, so it is current) — otherwise it would
  // write an unvalued exit for a variant just cut over. Costs one read per sale, and only while costing is off.
  if (!scope) scope = await activeCostingInTx(tx);
  if (!scope) {
    await tx.stockMovement.createMany({ data: items.map((item) => movement(item.variantId, -item.quantity, "ORDER", opts, orderId)) });
    return { oversold, stockAfter };
  }
  // One statement, run while this transaction holds the rows' locks (taken by the decrements above): writes the ORDER
  // movements and returns each variant's costing facts with a snapshot taken after the locks — no other transaction can
  // change a locked variant's position, so it is current. The costing service then values every exit in one call.
  const rows = await tx.$queryRaw<Array<{ id: string; variantId: string; change: number; reason: string; orderId: string | null; createdAt: Date; variantCreatedAt: Date; trackInventory: boolean; hasState: boolean } & StoredPosition>>`
    WITH mv AS (
      INSERT INTO "StockMovement" (id, "variantId", change, reason, "orderId", "adminId", note, "createdAt")
      SELECT x.id, x."variantId", x.change, 'ORDER'::"StockMovementReason", ${orderId}, ${opts.adminId ?? null}, ${opts.note ?? null}, (NOW() AT TIME ZONE 'UTC')
      FROM jsonb_to_recordset(${JSON.stringify(items.map((item) => ({ id: randomUUID(), variantId: item.variantId, change: -item.quantity })))}::jsonb) AS x(id text, "variantId" text, change int)
      RETURNING id, "variantId", change, reason::text AS reason, "orderId", "createdAt"
    )
    SELECT mv.*, v."createdAt" AS "variantCreatedAt", p."trackInventory", s."variantId" IS NOT NULL AS "hasState",
           s."valuedQty", s.value, s."avgUnitCost", s."unvaluedQty", s."deficitQty", s."deficitLayers"
    FROM mv JOIN "ProductVariant" v ON v.id = mv."variantId" JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "InventoryCostState" s ON s."variantId" = mv."variantId"`;
  const known = new Map<string, VariantCosting>(rows.map((r) => [r.variantId, { trackInventory: r.trackInventory, variantCreatedAt: r.variantCreatedAt, hasState: r.hasState, position: r.hasState ? r : null }]));
  const byVariant = new Map(rows.map((r) => [r.variantId, r]));
  await value(
    tx,
    items.map((item) => ({ movement: byVariant.get(item.variantId)!, basis: { kind: "ORDER_EXIT" as const, orderItemIds: item.orderItemIds ?? [] }, ledger: "ORDER" as const })),
    scope,
    known,
  );
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
  // Variant id order — the lock order every stock writer uses.
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { id: true, variantId: true, quantity: true, restockedQuantity: true, unitCostSnapshot: true },
    orderBy: [{ variantId: "asc" }, { id: "asc" }],
  });
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
    const mv = await tx.stockMovement.create({ data: movement(item.variantId, amount, kind === "return" ? "RETURN" : "CANCELLATION", opts, orderId) });
    // The units come back at the cost they left at — this line's own snapshot, never today's average.
    await value(tx, [{ movement: mv, basis: { kind: "SNAPSHOT", unitCostMinor: item.unitCostSnapshot }, ledger: "ORDER" }]);
    released.push({ orderItemId: item.id, variantId: item.variantId, quantity: amount });
    if (after - amount <= 0 && after > 0) replenished.push(item.variantId);
  }
  return { released, replenished };
}

/** Units an order modification removes before shipment (docs/ORDER_ADJUSTMENTS.md §14): the order's line rows shrink or
 * go away (the modification record keeps what they were), so the units are put back as a CANCELLATION movement on the
 * order — never through `restockedQuantity`, which tracks units released from lines that still exist. INV-3 holds per
 * line: −quantity(after) = −quantity(before) + released. The caller writes the line change in the same transaction. */
export async function releaseModifiedUnits(
  tx: Tx,
  orderId: string,
  /** `lines`: which order lines the units come from, with each line's recorded unit cost (Phase 4B: they come back at it). */
  units: Array<{ variantId: string; quantity: number; lines: Array<{ quantity: number; unitCostMinor: number | null }> }>,
  actor: Actor = {},
): Promise<string[]> {
  const replenished: string[] = [];
  for (const u of [...units].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0))) {
    if (u.quantity <= 0) continue;
    const after = await applyDelta(tx, u.variantId, u.quantity, false);
    if (after === null) continue; // the variant was hard-deleted since: nothing to put back
    const mv = await tx.stockMovement.create({ data: movement(u.variantId, u.quantity, "CANCELLATION", actor, orderId) });
    await value(tx, [{ movement: mv, basis: { kind: "SNAPSHOT_LINES", lines: u.lines }, ledger: "ORDER" }]);
    if (after - u.quantity <= 0 && after > 0) replenished.push(u.variantId);
  }
  return replenished;
}

/** Returned units that came back unsellable (damaged): after `releaseOrderLines(…, "return")` put them back, they are taken
 * straight out again as DAMAGED — so the ledger shows both what came back and what could not be resold. The write-off is
 * not attributed to the order (orderId null, the order number is in the note): INV-3 keeps an order's own movements equal
 * to −(quantity − restocked) per variant. */
export async function writeOffReturnedUnits(
  tx: Tx,
  orderNumber: string,
  /** `unitCostMinor`: the returned line's recorded unit cost — the write-off leaves at it (Phase 3 books it at the same cost). */
  units: Array<{ variantId: string; quantity: number; unitCostMinor: number | null }>,
  actor: Actor = {},
) {
  for (const u of units) {
    if (u.quantity <= 0) continue;
    const after = await applyDelta(tx, u.variantId, -u.quantity, false);
    if (after === null) continue;
    const mv = await tx.stockMovement.create({ data: movement(u.variantId, -u.quantity, "DAMAGED", { ...actor, note: `Returned damaged — order ${orderNumber}${actor.note ? `: ${actor.note}` : ""}` }) });
    await value(tx, [{ movement: mv, basis: { kind: "SNAPSHOT", unitCostMinor: u.unitCostMinor }, ledger: "ORDER" }]);
  }
}

/** Locks the variants' rows and reports which can't supply `quantity` units right now (tracked products only — D5). Lets a
 * paid settlement decide BEFORE writing anything whether a waiting modification can still be fulfilled (§14). `floors`:
 * fill-to-order variants may go that far below zero, as in recordSale (fill-capacity.service `fillToOrderFloorsFor`). */
export async function stockShortfalls(tx: Tx, units: Array<{ variantId: string; quantity: number }>, untracked: Set<string>, floors?: Map<string, number>): Promise<string[]> {
  const short: string[] = [];
  for (const u of [...units].sort((a, b) => (a.variantId < b.variantId ? -1 : 1))) {
    if (untracked.has(u.variantId)) continue;
    const stock = await lockStock(tx, u.variantId);
    if (stock === null || stock + (floors?.get(u.variantId) ?? 0) < u.quantity) short.push(u.variantId);
  }
  return short;
}

/** Restoring a pre-shipment order from Trash takes back the units released when it was trashed. All-or-nothing:
 * if any line's stock has since been sold, nothing changes and a 409 explains why. A fill-to-order line may take its stock
 * below zero by what can still be made, exactly as at checkout (docs/STOCK_HUB.md §3). Returns the variants it moved, for
 * `notifyStockMoved` after commit (fill-to-order lines and their materials; empty for any other order). */
export async function reReserveOrderLines(tx: Tx, orderId: string, actor: Actor = {}): Promise<string[]> {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { id: true, variantId: true, restockedQuantity: true, returnedQuantity: true, unitCostSnapshot: true },
    orderBy: [{ variantId: "asc" }, { id: "asc" }], // the lock order every stock writer uses
  });
  const fill = await fillToOrderFloorsFor(
    tx,
    items.map((item) => ({ variantId: item.variantId, quantity: item.restockedQuantity - item.returnedQuantity })).filter((l) => l.quantity > 0),
  );
  for (const item of items) {
    const amount = item.restockedQuantity - item.returnedQuantity;
    if (amount <= 0) continue;
    // Several lines of one variant share its floor: each takes from the stock the previous one left, so the floor holds.
    const after = await applyDelta(tx, item.variantId, -amount, true, fill?.floors.get(item.variantId) ?? 0);
    if (after === null) {
      throw AppError.conflict("Not enough stock to restore this order — its items have been sold since it was trashed. Adjust stock first.");
    }
    await tx.orderItem.update({ where: { id: item.id }, data: { restockedQuantity: { decrement: amount } } });
    const mv = await tx.stockMovement.create({ data: movement(item.variantId, -amount, "ORDER", actor, orderId) });
    // Undoes the trash release, which brought these units back at this line's cost: they leave at it again (a compensating
    // entry), so the line's recorded cost stays the cost of every one of its units.
    await value(tx, [{ movement: mv, basis: { kind: "SNAPSHOT", unitCostMinor: item.unitCostSnapshot }, ledger: "ORDER" }]);
  }
  return fillMoved(fill);
}

// --- document-driven movements (Phase 4D+: purchasing, later manufacturing) ----------------------

/** Reasons a stock document may move stock with. Each document owns the ledger posting of the value it moves. */
export type DocumentStockReason = "PURCHASE_RECEIPT" | "PURCHASE_RETURN" | "PRODUCTION_ISSUE" | "PRODUCTION_RETURN" | "PRODUCTION_RECEIPT";

export interface DocumentMovementInput {
  variantId: string;
  /** Signed: positive in, negative out. */
  change: number;
  reason: DocumentStockReason;
  /** Inflows: the document's value (DOCUMENT) or a line's own unit cost (SNAPSHOT — e.g. a receipt reversed at its cost);
   * outflows: AVERAGE or SNAPSHOT. */
  basis: MovementToValue["basis"];
}

/**
 * Moves stock for a stock document (goods receipt, supplier return, …) in the caller's transaction: one guarded update and
 * one movement per line, each valued by the costing service with the DOCUMENT as ledger owner — the caller posts the book
 * value it gets back (`valuation.figures.bookValue`); the costing side posts only a cost adjustment. Variants are locked in
 * id order. An outflow never takes stock below zero (409). Every line's variant must be costed: a document that moved
 * stock the valuation doesn't follow would split the books from the valuation, so it is refused (409).
 */
export async function recordDocumentMovements(tx: Tx, items: DocumentMovementInput[], actor: Actor = {}) {
  const ordered = items.map((item, index) => ({ item, index })).sort((a, b) => (a.item.variantId < b.item.variantId ? -1 : a.item.variantId > b.item.variantId ? 1 : a.index - b.index));
  const rows: Array<{ index: number; movement: MovementRow }> = [];
  const replenished: string[] = [];
  for (const { item, index } of ordered) {
    if (!Number.isSafeInteger(item.change) || item.change === 0) throw AppError.badRequest("A document line moves a whole, non-zero number of units");
    const after = await applyDelta(tx, item.variantId, item.change, item.change < 0);
    if (after === null) {
      const exists = await tx.productVariant.count({ where: { id: item.variantId } });
      throw exists ? AppError.conflict("Not enough stock for this document — it would take stock below zero") : AppError.notFound("Variant not found");
    }
    if (item.change > 0 && after - item.change <= 0 && after > 0) replenished.push(item.variantId);
    rows.push({ index, movement: await tx.stockMovement.create({ data: movement(item.variantId, item.change, item.reason, actor) }) });
  }
  rows.sort((a, b) => a.index - b.index);
  const valued = await value(tx, rows.map((r) => ({ movement: r.movement, basis: items[r.index]!.basis, ledger: "DOCUMENT" as const })));
  const unvalued = rows.filter((r) => !valued.has(r.movement.id));
  if (unvalued.length) throw AppError.conflict("Inventory costing doesn't follow some of these variants yet (costing inactive, or a variant not cut over) — stock documents need costed variants");
  return { lines: rows.map((r) => ({ movement: r.movement, valuation: valued.get(r.movement.id)! })), replenished };
}

// --- catalog-driven movements -------------------------------------------------------------------

/** Opening stock for a variant just created with stock 0 (product editor → RESTOCK, CSV import → IMPORT). */
export async function recordInitialStock(tx: Tx, variantId: string, quantity: number, reason: "RESTOCK" | "IMPORT", actor: Actor = {}) {
  if (quantity <= 0) return;
  await applyDelta(tx, variantId, quantity, false);
  const mv = await tx.stockMovement.create({ data: movement(variantId, quantity, reason, actor) });
  await value(tx, [{ movement: mv, basis: { kind: "AVERAGE" }, ledger: "MOVEMENT" }]);
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
  const mv = await tx.stockMovement.create({ data: movement(variantId, delta, "ADJUSTMENT", actor) });
  await value(tx, [{ movement: mv, basis: { kind: "AVERAGE" }, ledger: "MOVEMENT" }]);
  return delta;
}

/** A declared count (CSV import): sets stock to `counted` under a row lock and records the difference. */
export async function setVariantStockCount(tx: Tx, variantId: string, counted: number, reason: "IMPORT", actor: Actor = {}): Promise<number> {
  const current = await lockStock(tx, variantId);
  if (current === null) throw AppError.notFound("Variant not found");
  const delta = counted - current;
  if (delta === 0) return 0;
  await applyDelta(tx, variantId, delta, false);
  const mv = await tx.stockMovement.create({ data: movement(variantId, delta, reason, actor) });
  await value(tx, [{ movement: mv, basis: { kind: "AVERAGE" }, ledger: "MOVEMENT" }]);
  return delta;
}

/** A variant removed from its product but kept for its order history: its stock is written off to zero. */
export async function zeroVariantStock(tx: Tx, variantIds: string[], actor: Actor = {}) {
  for (const variantId of variantIds) {
    const current = await lockStock(tx, variantId);
    if (!current) continue;
    await applyDelta(tx, variantId, -current, false);
    const mv = await tx.stockMovement.create({ data: movement(variantId, -current, "ADJUSTMENT", actor) });
    await value(tx, [{ movement: mv, basis: { kind: "AVERAGE" }, ledger: "MOVEMENT" }]);
  }
}

// --- packaging a parcel used (owner's books §6.2) ----------------------------------------------------

/**
 * Packaging material a parcel used, recorded once per order and material (sourceType "OrderPackaging", sourceId the
 * order), valued at the running average and booked to packaging & fulfilment by the costing service. Never below zero:
 * a material that isn't in stock is skipped and reported (the next run takes it once stock is there).
 */
export async function recordPackagingUse(tx: Tx, orderId: string, items: Array<{ variantId: string; quantity: number }>, actor: Actor = {}) {
  const written: MovementRow[] = [];
  const short: Array<{ variantId: string; quantity: number }> = [];
  for (const it of [...items].sort((a, b) => (a.variantId < b.variantId ? -1 : 1))) {
    if (!Number.isSafeInteger(it.quantity) || it.quantity <= 0) continue;
    const done = await tx.stockMovement.findFirst({ where: { sourceType: "OrderPackaging", sourceId: orderId, variantId: it.variantId }, select: { id: true } });
    if (done) continue;
    const after = await applyDelta(tx, it.variantId, -it.quantity, true);
    if (after === null) {
      short.push(it);
      continue;
    }
    written.push(await tx.stockMovement.create({ data: { ...movement(it.variantId, -it.quantity, "PACKAGING_USE", actor), sourceType: "OrderPackaging", sourceId: orderId } }));
  }
  if (written.length) await value(tx, written.map((mv) => ({ movement: mv, basis: { kind: "AVERAGE" as const }, ledger: "MOVEMENT" as const })));
  return { written, short };
}

// --- manual adjustments -------------------------------------------------------------------------

/** Admin stock adjustment (Inventory → Adjust). Never below zero; DAMAGED/LOST must reduce stock, RESTOCK must
 * add (validated by adjustStockSchema, re-checked here since this is the authority).
 * `source`: the document line the adjustment is for (a stock hub count line) — written on the movement, and an adjustment
 * already made for it is not made again (a retry). `floor`: how far below zero stock may go (a fill-to-order variant whose
 * unfilled orders already took it below zero, docs/STOCK_HUB.md §3); 0 otherwise. */
export async function adjustVariantStock(variantId: string, delta: number, reason: ManualStockReason, adminId: string, note?: string | null, opts: { source?: { type: string; id: string }; floor?: number } = {}) {
  if (delta === 0) throw AppError.badRequest("Delta cannot be zero");
  if ((reason === "DAMAGED" || reason === "LOST") && delta > 0) throw AppError.badRequest("Damaged or lost stock must be a negative change");
  if (reason === "RESTOCK" && delta < 0) throw AppError.badRequest("A restock must add stock");
  const source = opts.source ? { sourceType: opts.source.type, sourceId: opts.source.id } : null;

  const { variant, replenished, moved } = await prisma.$transaction(async (tx) => {
    if (source && (await tx.stockMovement.findFirst({ where: { variantId, ...source }, select: { id: true } }))) {
      return { variant: await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } }), replenished: false, moved: false };
    }
    const after = await applyDelta(tx, variantId, delta, true, Math.max(0, opts.floor ?? 0));
    if (after === null) {
      const exists = await tx.productVariant.count({ where: { id: variantId } });
      throw exists ? AppError.conflict("Stock cannot go below zero") : AppError.notFound("Variant not found");
    }
    const mv = await tx.stockMovement.create({ data: { ...movement(variantId, delta, reason, { adminId, note }), ...source } });
    // Manual adjustments are valued at the running average (a gain labelled ESTIMATED, or unvalued when no cost was ever
    // known) and booked against shrinkage / count adjustments — never as a purchase.
    await value(tx, [{ movement: mv, basis: { kind: "AVERAGE" }, ledger: "MOVEMENT" }]);
    return { variant: await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } }), replenished: after - delta <= 0 && after > 0, moved: true };
  });
  if (replenished) notifyReplenished([variantId]);
  if (moved) notifyStockMoved([variantId]);
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
