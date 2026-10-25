import { Prisma } from "@prisma/client";
import { sellable, type ManualStockReason, type StockMovementListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { notifyBackInStock } from "../stock-alerts/stock-alert.service";
import { captureError } from "../../lib/observability/error-capture";
import { randomUUID } from "node:crypto";
import { hasFillToOrderProducts, refreshProductsUsingMaterials } from "../../domain/storefront/read-model.service";
import { fillCapacity, fillCapacityChanged, fillMoved, fillToOrderFloorsFor } from "../../domain/stock/fill-capacity.service";
import { activeCostingInTx, valueStockMovementsInTx, type CostingScope, type MovementToValue, type StoredPosition, type VariantCosting } from "../../domain/finance/costing.service";
import { settleReversedStockExceptionsInTx } from "../../domain/finance/finance-exceptions.service";
import { toMinor } from "../../domain/finance/finance-values";

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
async function value(
  tx: Tx,
  items: Array<{ movement: MovementRow; basis: MovementToValue["basis"]; ledger: MovementToValue["ledger"]; knownCause?: boolean }>,
  scope?: CostingScope | null,
  known?: Map<string, VariantCosting>,
) {
  return valueStockMovementsInTx(tx, items.map((i) => ({ movement: i.movement, basis: i.basis, ledger: i.ledger, knownCause: i.knownCause })), scope, known);
}

/** Fire-and-forget back-in-stock emails for variants whose stock just went from 0 to positive. Call after commit.
 * A fill-to-order variant is left out: its filled bottles crossing zero says nothing about whether it can be bought (it sells
 * what can still be made) — its shoppers are emailed when what it can sell goes from nothing to something (`flushStockMoved`). */
export function notifyReplenished(variantIds: string[]): void {
  const ids = [...new Set(variantIds)];
  if (!ids.length) return;
  void prisma.productVariant
    .findMany({ where: { id: { in: ids }, product: { fillToOrder: true } }, select: { id: true } })
    .then((filled) => {
      const skip = new Set(filled.map((v) => v.id));
      for (const id of ids) if (!skip.has(id)) notifyBackInStock(id).catch((err) => captureError(err, { msg: "[stock-alert] notify failed:" }));
    })
    .catch((err) => captureError(err, { msg: "[stock-alert] notify failed:" }));
}

/** Trailing debounce for the fill-to-order refresh: an attar sale (or a burst of them) refreshes the products that share its
 * materials once, after the moves stop for this long — at most MAX_WAIT after the first. In-process. */
const STOCK_MOVED_DEBOUNCE_MS = 2_000;
const STOCK_MOVED_MAX_WAIT_MS = 5_000;
const pendingMoved = new Set<string>();
let pendingSince = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
const refreshing = new Set<Promise<void>>();
/** What each fill-to-order variant could sell when last refreshed here — to spot "nothing → something" (back in stock). */
const lastSellable = new Map<string, number>();

/** Fire-and-forget after commit: these variants' stock moved, so the shop's memoised fill capacity is dropped (this
 * process; others within its TTL) and — coalesced (STOCK_MOVED_DEBOUNCE_MS) — every fill-to-order product whose recipe uses
 * one of them (a material), or that owns one, is refreshed for the storefront (docs/STOCK_HUB.md §3). Nothing at all when
 * no product is fill to order. */
export function notifyStockMoved(variantIds: string[]): void {
  if (!variantIds.length) return;
  fillCapacityChanged();
  for (const id of variantIds) pendingMoved.add(id);
  const now = Date.now();
  if (!pendingTimer) pendingSince = now;
  else clearTimeout(pendingTimer);
  const wait = Math.max(0, Math.min(STOCK_MOVED_DEBOUNCE_MS, pendingSince + STOCK_MOVED_MAX_WAIT_MS - now));
  pendingTimer = setTimeout(flushStockMoved, wait);
  pendingTimer.unref?.();
}

/** Runs the coalesced refresh now (the debounce timer, or `stockMovedSettled`). */
function flushStockMoved(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  const ids = [...pendingMoved];
  pendingMoved.clear();
  if (!ids.length) return;
  const run: Promise<void> = (async () => {
    if (!(await hasFillToOrderProducts())) return;
    const productIds = await refreshProductsUsingMaterials(ids);
    await notifySellableAgain(productIds);
  })()
    .catch((err) => captureError(err, { msg: "[read-model] fill-to-order refresh failed:" }))
    .finally(() => refreshing.delete(run));
  refreshing.add(run);
}

/** Back in stock for fill to order: a variant of these products that could sell nothing at its last refresh (in this
 * process) and can now — materials bought, an order cancelled — emails its waiting shoppers. The first refresh only
 * records (nothing known before it). */
async function notifySellableAgain(productIds: string[]): Promise<void> {
  if (!productIds.length) return;
  const variants = await prisma.productVariant.findMany({ where: { productId: { in: productIds }, product: { fillToOrder: true, trackInventory: true } }, select: { id: true, stock: true } });
  if (!variants.length) return;
  const made = await fillCapacity(prisma, { variantIds: variants.map((v) => v.id) });
  const again: string[] = [];
  for (const v of variants) {
    const now = sellable(v.stock, made.get(v.id) ?? 0);
    if (lastSellable.get(v.id) === 0 && now > 0) again.push(v.id);
    lastSellable.set(v.id, now);
  }
  for (const id of again) notifyBackInStock(id).catch((err) => captureError(err, { msg: "[stock-alert] notify failed:" }));
}

/** Runs any refresh still waiting for its debounce, then resolves once every refresh `notifyStockMoved` started so far has
 * finished (tests; a graceful shutdown; the go-live script). */
export async function stockMovedSettled(): Promise<void> {
  flushStockMoved();
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
  const rows = await tx.$queryRaw<Array<{ id: string; variantId: string; change: number; reason: string; orderId: string | null; createdAt: Date; variantCreatedAt: Date; trackInventory: boolean; fillToOrder: boolean; hasState: boolean } & StoredPosition>>`
    WITH mv AS (
      INSERT INTO "StockMovement" (id, "variantId", change, reason, "orderId", "adminId", note, "createdAt")
      SELECT x.id, x."variantId", x.change, 'ORDER'::"StockMovementReason", ${orderId}, ${opts.adminId ?? null}, ${opts.note ?? null}, (NOW() AT TIME ZONE 'UTC')
      FROM jsonb_to_recordset(${JSON.stringify(items.map((item) => ({ id: randomUUID(), variantId: item.variantId, change: -item.quantity })))}::jsonb) AS x(id text, "variantId" text, change int)
      RETURNING id, "variantId", change, reason::text AS reason, "orderId", "createdAt"
    )
    SELECT mv.*, v."createdAt" AS "variantCreatedAt", p."trackInventory", p."fillToOrder", s."variantId" IS NOT NULL AS "hasState",
           s."valuedQty", s.value, s."avgUnitCost", s."unvaluedQty", s."deficitQty", s."deficitLayers"
    FROM mv JOIN "ProductVariant" v ON v.id = mv."variantId" JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "InventoryCostState" s ON s."variantId" = mv."variantId"`;
  const known = new Map<string, VariantCosting>(rows.map((r) => [r.variantId, { trackInventory: r.trackInventory, variantCreatedAt: r.variantCreatedAt, hasState: r.hasState, position: r.hasState ? r : null, fillToOrder: r.fillToOrder }]));
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

/** Units back at the shop that can't be sold again — a cancelled parcel's damaged units, units the courier lost, or the
 * damaged part of an approved customer return: after `releaseOrderLines` closed them on the order, they leave again as
 * DAMAGED / LOST at the line's own cost. No return record books them, so the movement itself does (shrinkage,
 * `ledger: "MOVEMENT"`). Outside the order (INV-3), linked to it by sourceType "OrderParcelReceipt" / sourceId the order.
 * docs/ORDER_ADJUSTMENTS.md §8a. */
export async function writeOffParcelUnits(
  tx: Tx,
  order: { id: string; orderNumber: string },
  units: Array<{ variantId: string; quantity: number; unitCostMinor: number | null; reason: "DAMAGED" | "LOST" }>,
  actor: Actor = {},
) {
  for (const u of units) {
    if (u.quantity <= 0) continue;
    const after = await applyDelta(tx, u.variantId, -u.quantity, false);
    if (after === null) continue;
    const label = u.reason === "DAMAGED" ? "Came back damaged" : "Lost by the courier";
    const note = `${label} — order ${order.orderNumber}${actor.note ? `: ${actor.note}` : ""}`;
    const mv = await tx.stockMovement.create({ data: { ...movement(u.variantId, -u.quantity, u.reason, { ...actor, note }), sourceType: "OrderParcelReceipt", sourceId: order.id } });
    await value(tx, [{ movement: mv, basis: { kind: "SNAPSHOT", unitCostMinor: u.unitCostMinor }, ledger: "MOVEMENT", knownCause: true }]);
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
  // Only sales take a (fill-to-order) variant below zero; an edit never does — the schema lets an unchanged negative through.
  if (desired < 0) throw AppError.badRequest("Stock can't be set below 0");
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
  if (counted < 0) throw AppError.badRequest("A stock count can't be below 0");
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

/** Admin stock adjustment (Inventory → Adjust, and the assistant's tool). Never below zero; DAMAGED/LOST must reduce stock,
 * RESTOCK must add (validated by adjustStockSchema, re-checked here since this is the authority).
 * Once stock costing is live, a tracked item's stock only RISES through a document — Stock › Bought (a purchase with its
 * cost), Stock › Filled (bottles made from their materials) or Stock › Counted (an evidenced count) — so a manual increase
 * here is refused (STOCK_VIA_HUB): it would carry no cost source and book the value as a gain (inventory recovery F-a/F-b).
 * Write-offs and decreases are unchanged.
 * `source`: the document line the adjustment is for (a stock hub count line) — written on the movement, and an adjustment
 * already made for it is not made again (a retry). `floor`: how far below zero stock may go (a fill-to-order variant whose
 * unfilled orders already took it below zero, docs/STOCK_HUB.md §3); 0 otherwise. */
export async function adjustVariantStock(variantId: string, delta: number, reason: ManualStockReason, adminId: string, note?: string | null, opts: AdjustOptions = {}) {
  const result = await prisma.$transaction(async (tx) => {
    if (delta > 0) await assertManualIncreaseAllowed(tx, variantId);
    return adjustVariantStockInTx(tx, variantId, delta, reason, adminId, note, opts);
  });
  afterAdjustment(result);
  return result.variant;
}

/** F-a/F-b: refuses a manual increase of a tracked item once costing is live (see adjustVariantStock). */
async function assertManualIncreaseAllowed(tx: Tx, variantId: string) {
  if (!(await activeCostingInTx(tx))) return;
  const v = await tx.productVariant.findUnique({ where: { id: variantId }, select: { product: { select: { trackInventory: true, fillToOrder: true } } } });
  if (!v || !v.product.trackInventory) return;
  throw new AppError(
    409,
    v.product.fillToOrder
      ? "Stock costing is live: bottles come into stock only when they are filled. Record them on Stock › Filled bottles (or Stock › Received goods for bought-in bottles)."
      : "Stock costing is live: received goods come into stock only with their purchase. Record them on Stock › Received goods (or Stock › Count to correct a count).",
    { code: "STOCK_VIA_HUB" },
  );
}

export interface AdjustOptions {
  source?: { type: string; id: string };
  floor?: number;
  /** An increase comes in with no value (held unvalued, raised as stock received without a cost) instead of at the running
   * average against 5210 — a count gain is never booked as income on its own (inventory recovery F-b). */
  unvaluedGain?: boolean;
}
export interface AdjustResult {
  variant: Prisma.ProductVariantGetPayload<object>;
  /** Went from 0 or below to above 0 (a back-in-stock crossing). */
  replenished: boolean;
  /** A movement was written (false: the source's adjustment was already made). */
  moved: boolean;
}

/** `adjustVariantStock` inside the caller's transaction — for a caller that must read something (units waiting on orders, an
 * expectation) under the same variant row lock the adjustment takes, so no sale can slip in between (lock it first with
 * `lockVariantStock`). The caller hands the result to `afterAdjustment` once its transaction has committed. */
export async function adjustVariantStockInTx(tx: Tx, variantId: string, delta: number, reason: ManualStockReason, adminId: string | null, note?: string | null, opts: AdjustOptions = {}): Promise<AdjustResult> {
  if (delta === 0) throw AppError.badRequest("Delta cannot be zero");
  if ((reason === "DAMAGED" || reason === "LOST") && delta > 0) throw AppError.badRequest("Damaged or lost stock must be a negative change");
  if (reason === "RESTOCK" && delta < 0) throw AppError.badRequest("A restock must add stock");
  const source = opts.source ? { sourceType: opts.source.type, sourceId: opts.source.id } : null;
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
  // known) and booked against shrinkage / count adjustments — never as a purchase. `unvaluedGain`: a gain carries no value.
  const basis = opts.unvaluedGain && delta > 0 ? { kind: "SNAPSHOT" as const, unitCostMinor: null } : { kind: "AVERAGE" as const };
  await value(tx, [{ movement: mv, basis, ledger: "MOVEMENT" }]);
  return { variant: await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } }), replenished: after - delta <= 0 && after > 0, moved: true };
}

/** Movements a person made by hand — the ones a correction may reverse. Orders, returns, purchases, fills and production
 * are undone through their own documents (cancel the order, reverse the receipt…). */
const REVERSIBLE_REASONS = new Set(["RESTOCK", "ADJUSTMENT", "IMPORT", "DAMAGED", "LOST"]);

export interface ReverseInput {
  reason: string;
  /** The item was counted again after the mistaken entry — that count may already have corrected it. */
  acknowledgeLaterCount?: boolean;
}

/**
 * Stock correction (docs/STOCK_HUB.md §10): undoes one hand-made movement exactly — the opposite number of units, with
 * the same reason (so the same account), and in the books exactly what the movement booked (costing's REVERSAL basis), so
 * a mistaken +200 that booked a gain is cancelled to the paisa, not counted away at today's average. The correction is
 * linked to the movement (at most once — the database refuses a second), is never itself reversed, keeps the original in
 * the history, and settles the original's open "without a value" exception. Refused when the units are no longer there
 * (sold or used since — count the item instead), for a movement from before stock costing went live (its value never
 * reached the books — the go-live count replaced it), and, unless acknowledged, when the item was counted again since.
 */
export async function reverseStockMovement(movementId: string, input: ReverseInput, actor: { type: "ADMIN"; adminId: string; label: string; permissions: readonly string[] }) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw AppError.badRequest("Say why this entry was wrong");
  const result = await prisma.$transaction(async (tx) => {
    const orig = await tx.stockMovement.findUnique({
      where: { id: movementId },
      select: {
        id: true, variantId: true, change: true, reason: true, createdAt: true, reversesMovementId: true,
        reversedBy: { select: { id: true } },
        valuationEntry: { select: { bookValue: true, unvaluedQtyChange: true, valuationStatus: true } },
        variant: { select: { sku: true, product: { select: { fillToOrder: true } } } },
      },
    });
    if (!orig) throw AppError.notFound("Stock entry not found");
    if (orig.reversesMovementId) throw new AppError(409, "This entry is itself a correction — it can't be reversed", { code: "REVERSAL_OF_REVERSAL" });
    if (orig.reversedBy) throw new AppError(409, "This entry was already reversed", { code: "ALREADY_REVERSED" });
    if (!REVERSIBLE_REASONS.has(orig.reason)) throw new AppError(409, "Only a hand-made entry (restock, adjustment, import, damaged, lost) is reversed here — undo an order, return, purchase or fill through its own page", { code: "NOT_REVERSIBLE" });
    if ((await lockStock(tx, orig.variantId)) === null) throw AppError.notFound("Variant not found");
    const scope = await activeCostingInTx(tx);
    if (scope && !orig.valuationEntry) {
      throw new AppError(409, "This entry is from before stock costing went live — its value never reached the books and the go-live count replaced it. Correct the item with a count.", { code: "BEFORE_COSTING" });
    }
    if (!input.acknowledgeLaterCount) {
      // any count of the item since (a count that found it right moved nothing, but it still checked the shelf)
      const later = await tx.stockCount.findFirst({ where: { variantId: orig.variantId, createdAt: { gt: orig.createdAt } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
      if (later) throw new AppError(409, `${orig.variant.sku} was counted again on ${later.createdAt.toISOString().slice(0, 10)}, after this entry — that count may already have corrected it. Reversing it too would correct it twice.`, { code: "COUNTED_SINCE", countedAt: later.createdAt });
    }
    // A fill-to-order size may go below zero as far as its orders waiting to be packed (bottles owed); anything else not below zero.
    const floor = orig.variant.product.fillToOrder ? await waitingUnits(tx, orig.variantId) : 0;
    const delta = -orig.change;
    const after = await applyDelta(tx, orig.variantId, delta, true, floor);
    if (after === null) throw new AppError(409, `Not enough ${orig.variant.sku} left to take ${Math.abs(delta)} back — some of it was sold or used since. Count the item instead.`, { code: "NOT_ENOUGH_LEFT" });
    const mv = await tx.stockMovement.create({
      data: {
        ...movement(orig.variantId, delta, orig.reason as MovementReason, { adminId: actor.adminId, note: `Correction of the ${orig.createdAt.toISOString().slice(0, 10)} entry (${orig.change > 0 ? "+" : ""}${orig.change}): ${reason}` }),
        sourceType: "StockMovementReversal", sourceId: orig.id, reversesMovementId: orig.id,
      },
    });
    if (scope && orig.valuationEntry) {
      const cur = scope.business.baseCurrency;
      await value(tx, [{
        movement: mv, ledger: "MOVEMENT", knownCause: true,
        basis: { kind: "REVERSAL", of: { bookMinor: toMinor(orig.valuationEntry.bookValue, cur), unvaluedQtyChange: orig.valuationEntry.unvaluedQtyChange, status: orig.valuationEntry.valuationStatus } },
      }], scope);
    }
    await settleReversedStockExceptionsInTx(tx, orig.id, mv.id, reason, actor);
    return { variant: await tx.productVariant.findUniqueOrThrow({ where: { id: orig.variantId } }), replenished: after - delta <= 0 && after > 0, moved: true, movement: mv };
  });
  afterAdjustment(result);
  return { movement: result.movement, stock: result.variant.stock };
}

/** Units of a variant on orders not yet handed to the courier (still PENDING…PACKED) — how far a fill-to-order size may owe. */
async function waitingUnits(tx: Tx, variantId: string): Promise<number> {
  const rows = await tx.orderItem.aggregate({
    where: { variantId, order: { deletedAt: null, courierConsignmentId: null, status: { in: ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"] } } },
    _sum: { quantity: true, restockedQuantity: true },
  });
  return Math.max(0, (rows._sum.quantity ?? 0) - (rows._sum.restockedQuantity ?? 0));
}

/** After commit: back-in-stock emails and the storefront refresh for an adjustment made with `adjustVariantStockInTx`. */
export function afterAdjustment(result: Pick<AdjustResult, "variant" | "replenished" | "moved">): void {
  if (result.replenished) notifyReplenished([result.variant.id]);
  if (result.moved) notifyStockMoved([result.variant.id]);
}

/** Row-locked read of a variant's stock (null if it doesn't exist) — the lock every stock change takes, held to the end of
 * the caller's transaction. */
export async function lockVariantStock(tx: Tx, variantId: string): Promise<number | null> {
  return lockStock(tx, variantId);
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
    (p) => prisma.stockMovement.findMany({ where, include: { ...include, reverses: { select: { id: true, createdAt: true, change: true } }, reversedBy: { select: { id: true, createdAt: true } } }, orderBy: { createdAt: "desc" }, ...p }),
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
