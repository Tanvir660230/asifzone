/**
 * Stock hub — Counted (docs/STOCK_HUB.md §2). What is on the shelf is compared with what should be:
 *
 *   expected on the shelf = stock + units on orders not yet booked with the courier
 *
 * (an order takes its units out of stock when it is placed, but they stay on the shelf until the parcel leaves — so a count
 * made while orders wait unpacked shows no false loss). Each line is kept as a StockCount (the existing record of counts),
 * and a difference is booked through inventory.service: a loss at the running average (DAMAGED / LOST as they are, a sample
 * given away as ADJUSTMENT noted "sample"); a gain (FOUND / COUNT_FIX, as ADJUSTMENT) comes in unvalued — no income is
 * booked for it, and it waits as stock received without a cost until the owner enters the cost (inventory recovery F-b).
 * A shortfall needs its reason. Nothing is typed over.
 *
 * Works for finished goods and materials alike (oil in ml). A fill-to-order variant's stock may already be below zero
 * (ordered, not filled): a loss of filled bottles may take it further down, never below −(units waiting), i.e. counted ≥ 0.
 * Idempotent by the request's key (hub-entry.ts); each line's adjustment carries the line as its source, so a retry never
 * books it twice.
 */
import type { Prisma } from "@prisma/client";
import { stockCountsSchema, type StockCountReason, type StockCountsInput } from "@clothing-brand/shared";
import { prisma, type Db } from "../../config/prisma";
import { adjustVariantStockInTx, afterAdjustment, lockVariantStock } from "../../modules/inventory/inventory.service";
import type { FinanceActor } from "../finance/finance-audit";
import { businessToday, getFinanceContext } from "../finance/finance-context";
import { businessDateOf, financeError } from "../finance/finance-values";
import { recordStockCountInTx } from "../finance/stock-check.service";
import { financeTransaction } from "../finance/finance-tx";
import { claimEntry, completeEntry, fingerprintOf, releaseEntry, renewLease, saveSteps, unitOf, variantLabel } from "./hub-entry";

/** Order statuses whose units are still on the shelf (packed at most; not yet handed to the courier). */
export const ON_SHELF_STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"] as const;

export function expectedOnShelf(stock: number, reservedNotDispatched: number): number {
  return stock + reservedNotDispatched;
}

/** Units per variant on orders not in Trash, not cancelled, without a courier consignment, still PENDING…PACKED —
 * less what was already put back. `variantIds` limits the answer. */
export async function reservedNotDispatched(db: Db, variantIds?: string[]): Promise<Map<string, number>> {
  const rows = await db.orderItem.groupBy({
    by: ["variantId"],
    where: { ...(variantIds ? { variantId: { in: variantIds } } : {}), order: { deletedAt: null, courierConsignmentId: null, status: { in: [...ON_SHELF_STATUSES] } } },
    _sum: { quantity: true, restockedQuantity: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) if (r.variantId) out.set(r.variantId, Math.max(0, (r._sum.quantity ?? 0) - (r._sum.restockedQuantity ?? 0)));
  return out;
}

const LOSSES = new Set<StockCountReason>(["DAMAGED", "LOST", "SAMPLE"]);
const MOVEMENT_REASON: Record<StockCountReason, "DAMAGED" | "LOST" | "ADJUSTMENT"> = { DAMAGED: "DAMAGED", LOST: "LOST", SAMPLE: "ADJUSTMENT", FOUND: "ADJUSTMENT", COUNT_FIX: "ADJUSTMENT" };
const REASON_WORD: Record<StockCountReason, string> = { DAMAGED: "damaged", LOST: "lost", SAMPLE: "sample", FOUND: "found", COUNT_FIX: "count fix" };

/** A difference and its reason must agree: a shortfall needs a loss reason or a count fix; a gain is found or a fix. */
function reasonProblem(name: string, difference: number, reason: StockCountReason | null | undefined): string | null {
  if (difference < 0 && !reason) return `${name}: ${-difference} short — say why (damaged, lost, sample or count fix)`;
  if (difference > 0 && reason && LOSSES.has(reason)) return `${name}: ${difference} more than expected — that is found, or a count fix`;
  return null;
}

interface CountLine {
  variantId: string;
  name: string;
  unit: string;
  counted: number;
  reason: StockCountReason | null;
  note: string | null;
  fillToOrder: boolean;
  expected?: number;
  difference?: number;
  stockCountId?: string;
  movementId?: string | null;
  done?: boolean;
}
interface CountSteps {
  lines: CountLine[];
}

const lineSource = (entryId: string, i: number) => ({ type: "StockHubEntry", id: countSource(entryId, i) });
/** A count line: `<entry id>:<line>` — the StockCount and the stock movement it makes carry it, so a retry finds them. */
const countSource = (entryId: string, i: number) => `${entryId}:${i}`;

/** Records a count (see the file header). */
export async function recordCounts(raw: StockCountsInput, actor: FinanceActor, key: string | null) {
  if (!key) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every count");
  if (actor.type !== "ADMIN") throw financeError(403, "COUNT_BY_ADMIN", "A count is recorded by a person");
  const input = stockCountsSchema.parse(raw);
  const { business } = await getFinanceContext();
  const today = businessToday(business);
  if (input.date && input.date > today) throw financeError(400, "STOCK_COUNT_FUTURE", "A count can't be dated in the future");

  const ids = input.lines.map((l) => l.variantId);
  // A product counted as a whole grid: every active size / colour must be on the sheet (F-c), checked before any write.
  if (input.products?.length) {
    const grid = await prisma.productVariant.findMany({ where: { productId: { in: input.products }, isActive: true }, select: { id: true, sku: true } });
    const listed = new Set(ids);
    const missing = grid.filter((g) => !listed.has(g.id)).map((g) => g.sku);
    if (missing.length) throw financeError(400, "COUNT_SCOPE_INCOMPLETE", `Not on the sheet: ${missing.join(", ")} — enter 0 for a size you have none of`, { missing });
  }
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: ids } },
    select: { id: true, stock: true, size: true, color: true, product: { select: { name: true, kind: true, stockUnit: true, trackInventory: true, fillToOrder: true, deletedAt: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const reserved = await reservedNotDispatched(prisma, ids);
  const problems: string[] = [];
  for (const [i, l] of input.lines.entries()) {
    const v = byId.get(l.variantId);
    if (!v || v.product.deletedAt) throw financeError(400, "VARIANT_NOT_FOUND", `Line ${i + 1}: item not found`);
    if (!v.product.trackInventory) throw financeError(400, "COUNT_UNTRACKED", `Line ${i + 1}: ${variantLabel(v)} isn't stock-tracked`);
    const waiting = reserved.get(v.id) ?? 0;
    // Fewer on the shelf than orders are waiting for: stock would go below zero — only a fill-to-order variant may.
    if (!v.product.fillToOrder && l.counted < waiting) {
      throw financeError(409, "COUNT_BELOW_ORDERS", `${variantLabel(v)}: ${l.counted} on the shelf but ${waiting} on orders waiting to be packed — check those orders first`);
    }
    const problem = reasonProblem(variantLabel(v), l.counted - expectedOnShelf(v.stock, waiting), l.reason);
    if (problem) problems.push(problem);
  }
  if (problems.length) throw financeError(400, "COUNT_REASON", problems.join("; "), { lines: problems });

  const initial: CountSteps = {
    lines: input.lines.map((l) => {
      const v = byId.get(l.variantId)!;
      return { variantId: l.variantId, name: variantLabel(v), unit: unitOf(v.product), counted: l.counted, reason: l.reason ?? null, note: l.note, fillToOrder: v.product.fillToOrder };
    }),
  };
  const { entry, done, lease } = await claimEntry({ businessId: business.id, kind: "COUNT", key, fingerprint: fingerprintOf(input), entryDate: input.date ?? today, steps: initial as never, actor });
  if (done || !lease) return outcome(entry.id, businessDateOf(entry.entryDate), entry.steps as unknown as CountSteps, true);

  const steps = entry.steps as unknown as CountSteps;
  const date = businessDateOf(entry.entryDate);
  try {
    for (const [i, line] of steps.lines.entries()) {
      if (line.done) continue;
      await renewLease(lease);
      const sourceId = countSource(entry.id, i);
      const reason: StockCountReason = line.reason ?? "FOUND";
      const note = `Stock count ${date}: ${REASON_WORD[reason]}${line.note ? ` — ${line.note}` : ""}`.slice(0, 300);
      const source = lineSource(entry.id, i);
      // One transaction per line, under the variant's row lock (the lock every sale takes): the expectation (stock + units
      // waiting on orders), the count kept with it and the adjustment can't be split by an order placed in between.
      const booked = await financeTransaction(async (tx) => {
        const stock = await lockVariantStock(tx, line.variantId);
        if (stock === null) throw financeError(400, "VARIANT_NOT_FOUND", `${line.name}: item not found`);
        const waiting = (await reservedNotDispatched(tx, [line.variantId])).get(line.variantId) ?? 0;
        // Recorded on an earlier attempt: its expectation stands (any adjustment made for it is found by its source).
        const seen = await tx.stockCount.findUnique({ where: { sourceId }, select: { id: true, siteStock: true } });
        const expected = seen ? seen.siteStock : expectedOnShelf(stock, waiting);
        const difference = line.counted - expected;
        if (!seen) {
          const problem = reasonProblem(line.name, difference, line.reason);
          if (problem) throw financeError(409, "COUNT_REASON", `${problem} (stock moved while counting)`, { lines: [problem] });
        }
        // kept with what should have been on the shelf, so Finance → Stock check shows the true difference
        const stockCountId = seen ? seen.id : (await recordStockCountInTx(tx, business, { variantId: line.variantId, counted: line.counted, countDate: date, note: line.note, expected, sourceId }, actor)).id;
        if (!difference) return { expected, difference, stockCountId, movementId: null, adjusted: null };
        // A gain comes in unvalued (F-b): no income is booked for units nobody bought — the owner enters their cost from the
        // bill (Finance › Exceptions) or approves an estimate. A loss leaves at the running average, as before.
        const adjusted = await adjustVariantStockInTx(tx, line.variantId, difference, MOVEMENT_REASON[reason], actor.adminId, note, { source, floor: line.fillToOrder ? waiting : 0, unvaluedGain: true });
        const mv = await tx.stockMovement.findFirstOrThrow({ where: { variantId: line.variantId, sourceType: source.type, sourceId: source.id }, select: { id: true } });
        return { expected, difference, stockCountId, movementId: mv.id, adjusted };
      });
      if (booked.adjusted) afterAdjustment(booked.adjusted);
      Object.assign(line, { expected: booked.expected, difference: booked.difference, stockCountId: booked.stockCountId, movementId: booked.movementId, done: true });
      await saveSteps(lease, steps as never);
    }
    await completeEntry(lease, steps as never);
    return outcome(entry.id, date, steps, false);
  } catch (err) {
    await releaseEntry(lease);
    throw err;
  }
}

function outcome(id: string, date: string, s: CountSteps, replayed: boolean) {
  return {
    id,
    date,
    replayed,
    lines: s.lines.map((l) => ({ variantId: l.variantId, expected: l.expected ?? 0, counted: l.counted, difference: l.difference ?? 0, movementId: l.movementId ?? null })),
  };
}

export type StockCountsResult = Prisma.PromiseReturnType<typeof recordCounts>;
