/**
 * Inventory costing — the ONE costing engine (Financial Core Phase 4, docs/FINANCE_PHASE_4.md §5–§6, §13, §15–§17).
 * Perpetual moving weighted-average cost per variant; the only writer of InventoryValuationEntry / InventoryCostState
 * (architecture guard). Nothing else computes an average cost.
 *
 * Arithmetic is integer only: values are BigInt minor units of the base currency; the average is kept as a scaled integer
 * (major units × 10^6); every division rounds half-to-even. No floating point touches an amount.
 *
 * The position of a variant: `valuedQty` units worth `value`; `unvaluedQty` units held with no known cost (never valued at
 * zero — PHASE_6_AUDIT "missing cost is not zero"); `deficitQty` units issued beyond stock (negative inventory, §15), with
 * the provisional cost each was issued at. Physical units = valuedQty + unvaluedQty − deficitQty.
 *
 * A deficit layer is BOOKED (the default: its issue posted the provisional cost as a cost adjustment, Dr inventory /
 * Cr 5150, and its cover posts the whole covered value back, so 5150 nets to actual − provisional) or UNBOOKED (a
 * fill-to-order bottle sold before it is filled, at its moving average or else its recipe's standard cost, or ordered-not-filled at the cutover —
 * docs/STOCK_HUB.md §3): its provisional cost is held OFF the inventory account, so its issue posts nothing and its cover
 * posts only actual − provisional. Every entry states `unbookedDeficitChange` (the change of the unbooked layers' value);
 * the ledger posts `costAdjustment − unbookedDeficitChange`, and the ledger bridge subtracts the unbooked deficit's value
 * (inventory-cutover.service inventoryLedgerBridge), so ledger = valuation + in-transit − unbooked deficit throughout.
 *
 * Every entry states `valueChange` (what the valuation moved) and `bookValue` (what the ledger's inventory account moves for
 * the same fact, posted by that fact's owner: Phase 3 for order-linked units at the line snapshot, Phase 4 documents
 * otherwise). `costAdjustment = valueChange − bookValue` is posted to inventory against 5150 Inventory cost adjustments, so
 * the ledger equals the valuation after every entry. Deficit cover, rounding at zero, late price differences and landed
 * costs on sold units are all this one rule — no journal is ever rewritten.
 *
 * 4B: inventory.service calls the integration functions at the end of this file for every stock movement; costing is
 * authoritative once activated (by the 4C valuation cutover).
 */
import { Prisma, type FinanceValuationStatus, type InventoryCostState, type InventoryValuationKind } from "@prisma/client";
import { businessDate, minorDigits, type AccountMappingKey } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { randomUUID } from "node:crypto";
import { financeError } from "./finance-values";
import { FINANCE_BUSINESS_KEY } from "./finance-context";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { recordFinancialEvent } from "./events.service";
import { INVENTORY_VALUED_EVENT } from "./inventory-posting-rules";

// ── arithmetic ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Major-unit decimals of the average (Decimal(18,6) columns). */
export const AVG_DECIMALS = 6;

/** n / d rounded half to even; d > 0. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("divRound: divisor must be positive");
  const neg = n < 0n;
  const a = neg ? -n : n;
  let q = a / d;
  const r = a - q * d;
  if (r * 2n > d || (r * 2n === d && q % 2n === 1n)) q += 1n;
  return neg ? -q : q;
}

const pow10 = (e: number) => 10n ** BigInt(e);

/** The scale that turns minor units into the average's 10^-6 major units for `currency`. */
function avgScale(currency: string): bigint {
  const digits = minorDigits(currency);
  if (digits > AVG_DECIMALS) throw new Error(`currency ${currency} has more than ${AVG_DECIMALS} minor digits`);
  return pow10(AVG_DECIMALS - digits);
}

// ── the position and its operations (pure) ───────────────────────────────────────────────────────────────────────

export interface DeficitLayer {
  qty: number;
  /** Provisional unit cost the units were issued at (minor units); null = issued with no cost known. */
  unitCostMinor: number | null;
  /** The provisional cost is held off the inventory account (see the header); absent = booked. */
  unbooked?: true;
}

export interface CostPosition {
  valuedQty: number;
  /** Minor units. */
  value: bigint;
  /** Average unit cost of valued units in 10^-6 major units; kept when valuedQty reaches 0; null until ever known. */
  avgScaled: bigint | null;
  unvaluedQty: number;
  deficitQty: number;
  deficitLayers: DeficitLayer[];
}

export const EMPTY_POSITION: CostPosition = Object.freeze({ valuedQty: 0, value: 0n, avgScaled: null, unvaluedQty: 0, deficitQty: 0, deficitLayers: [] }) as CostPosition;

export type CostBasis = "SNAPSHOT" | "AVERAGE" | "DOCUMENT" | "MANUAL" | "CUTOVER" | "NONE";

export type CostOperation =
  /** Units in at a known total value (receipt, return at snapshot, count gain at a cost); valueMinor null = no cost known. */
  | {
      type: "INFLOW";
      qty: number;
      valueMinor: number | null;
      basis: Exclude<CostBasis, "CUTOVER">;
      status?: Extract<FinanceValuationStatus, "KNOWN" | "ESTIMATED">;
      /** Of `qty`, units with no known cost (e.g. one returning batch mixing lines with and without a recorded cost): they are
       * held unvalued; `valueMinor` is the value of the other units. */
      unvaluedQty?: number;
    }
  /** Units out. SNAPSHOT: an order line's own unit cost (null = the line has none); AVERAGE: at the running average.
   * `unbooked`: the units issued beyond stock are an unbooked layer (a fill-to-order recipe cost — see the header). */
  | { type: "OUTFLOW"; qty: number; basis: { kind: "SNAPSHOT"; unitCostMinor: number | null; unbooked?: boolean } | { kind: "AVERAGE" } }
  /** A value change (late invoice difference, landed cost) for `qty` units received earlier: the share still held revalues
   * the stock, the rest (sold) becomes a cost adjustment. */
  | { type: "REVALUE"; deltaMinor: number; qty: number }
  /** The one-time cutover: the variant's first entry. qty = its physical stock (may be ≤ 0); valueMinor null = no cost.
   * `deficitUnitCostMinor`: units short (qty < 0) of a fill-to-order variant start as an unbooked layer at this cost. */
  | { type: "CUTOVER"; qty: number; valueMinor: number | null; status?: Extract<FinanceValuationStatus, "KNOWN" | "ESTIMATED">; deficitUnitCostMinor?: number | null };

export interface CostEntryFigures {
  kind: InventoryValuationKind;
  qtyChange: number;
  valueChange: bigint;
  bookValue: bigint;
  costAdjustment: bigint;
  unitCostScaled: bigint | null;
  costBasis: CostBasis;
  valuationStatus: FinanceValuationStatus;
  deficitQtyChange: number;
  coveredQty: number;
  unvaluedQtyChange: number;
  /** Of a covering inflow: the provisional value the covered units had been issued at, and how many had none. */
  coveredProvisional: bigint;
  coveredWithoutCost: number;
  /** Change of the unbooked deficit layers' value (minor units): + when issued, − when covered. The ledger posts
   * `costAdjustment − unbookedDeficitChange`. */
  unbookedDeficitChange: bigint;
}

const WORST: FinanceValuationStatus[] = ["KNOWN", "ESTIMATED", "MISSING"];
const worst = (...s: FinanceValuationStatus[]) => WORST[Math.max(...s.map((x) => WORST.indexOf(x)))] as FinanceValuationStatus;

function assertQty(n: number, what: string) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${what} must be a positive whole number`);
}
function assertMinor(n: number, what: string) {
  if (!Number.isSafeInteger(n)) throw new Error(`${what} must be whole minor units`);
}

function withAverage(p: CostPosition, scale: bigint): CostPosition {
  return p.valuedQty > 0 ? { ...p, avgScaled: divRound(p.value * scale, BigInt(p.valuedQty)) } : p;
}

/** Applies one operation to a position — the whole costing method. Pure and deterministic. */
export function applyCostOperation(pos: CostPosition, op: CostOperation, currency: string): { next: CostPosition; entry: CostEntryFigures } {
  const scale = avgScale(currency);
  const base = { coveredQty: 0, coveredProvisional: 0n, coveredWithoutCost: 0, deficitQtyChange: 0, unvaluedQtyChange: 0, unbookedDeficitChange: 0n };

  if (op.type === "CUTOVER") {
    if (pos !== EMPTY_POSITION && (pos.valuedQty || pos.unvaluedQty || pos.deficitQty || pos.value || pos.avgScaled !== null)) throw new Error("a cutover is only a variant's first valuation");
    if (!Number.isSafeInteger(op.qty)) throw new Error("cutover qty must be a whole number");
    if (op.valueMinor !== null) assertMinor(op.valueMinor, "cutover value");
    if (op.qty <= 0 && op.valueMinor) throw new Error("a cutover with no units on hand carries no value");
    if (op.valueMinor !== null && op.valueMinor < 0) throw new Error("a cutover value can't be negative");
    const short = op.qty < 0 ? (op.deficitUnitCostMinor ?? null) : null;
    if (short !== null) {
      assertMinor(short, "cutover deficit unit cost");
      if (short < 0) throw new Error("a unit cost can't be negative");
    }
    const valued = op.qty > 0 && op.valueMinor !== null;
    const next = withAverage({
      valuedQty: valued ? op.qty : 0,
      value: valued ? BigInt(op.valueMinor!) : 0n,
      avgScaled: null,
      unvaluedQty: op.qty > 0 && !valued ? op.qty : 0,
      deficitQty: op.qty < 0 ? -op.qty : 0,
      deficitLayers: op.qty < 0 ? [short === null ? { qty: -op.qty, unitCostMinor: null } : { qty: -op.qty, unitCostMinor: short, unbooked: true as const }] : [],
    }, scale);
    const valueChange = next.value;
    return {
      next,
      entry: {
        ...base, kind: "CUTOVER", qtyChange: op.qty, valueChange, bookValue: valueChange, costAdjustment: 0n,
        unitCostScaled: next.avgScaled, costBasis: "CUTOVER",
        valuationStatus: op.qty > 0 && !valued ? "MISSING" : op.qty < 0 ? (short === null ? "MISSING" : "ESTIMATED") : (op.status ?? "KNOWN"),
        deficitQtyChange: next.deficitQty, unvaluedQtyChange: next.unvaluedQty,
        unbookedDeficitChange: short === null ? 0n : BigInt(short) * BigInt(-op.qty),
      },
    };
  }

  if (op.type === "INFLOW" && op.unvaluedQty) {
    assertQty(op.qty, "inflow qty");
    assertQty(op.unvaluedQty, "unvalued qty");
    if (op.unvaluedQty > op.qty) throw new Error("unvalued qty exceeds the inflow");
    if (op.unvaluedQty === op.qty || op.valueMinor === null) return applyCostOperation(pos, { ...op, valueMinor: null, unvaluedQty: undefined }, currency);
    // The units without a cost first (they net off units issued short with no cost — below), then the valued ones.
    const n = applyCostOperation(pos, { type: "INFLOW", qty: op.unvaluedQty, valueMinor: null, basis: op.basis }, currency);
    const r = applyCostOperation(n.next, { ...op, qty: op.qty - op.unvaluedQty, unvaluedQty: undefined }, currency);
    return {
      next: r.next,
      entry: {
        ...r.entry, qtyChange: op.qty, valuationStatus: "MISSING",
        unvaluedQtyChange: n.entry.unvaluedQtyChange + r.entry.unvaluedQtyChange,
        deficitQtyChange: n.entry.deficitQtyChange + r.entry.deficitQtyChange,
        coveredQty: n.entry.coveredQty + r.entry.coveredQty,
        coveredWithoutCost: n.entry.coveredWithoutCost + r.entry.coveredWithoutCost,
        unbookedDeficitChange: n.entry.unbookedDeficitChange + r.entry.unbookedDeficitChange,
      },
    };
  }

  if (op.type === "INFLOW") {
    assertQty(op.qty, "inflow qty");
    if (op.valueMinor === null) {
      // No cost known: the units are held unvalued — never at zero cost, and they don't settle a deficit issued at a
      // provisional cost (whose true cost would still be unknown). Units issued short with NO cost are netted off first
      // (FIFO over those layers): neither side was ever valued or booked, so they cancel — a cancelled sale of a variant
      // that never had a cost (a fill-to-order bottle never filled) leaves no unvalued units and no phantom deficit for the
      // next receipt to "cover". Nothing is valued at zero and the ledger doesn't move.
      let left = op.qty;
      const layers: DeficitLayer[] = [];
      for (const l of pos.deficitLayers) {
        if (left === 0 || l.unitCostMinor !== null) { layers.push(l); continue; }
        const take = Math.min(left, l.qty);
        left -= take;
        if (l.qty > take) layers.push({ qty: l.qty - take, unitCostMinor: null });
      }
      const netted = op.qty - left;
      const next = { ...pos, unvaluedQty: pos.unvaluedQty + left, deficitQty: pos.deficitQty - netted, deficitLayers: netted ? layers : pos.deficitLayers };
      return {
        next,
        entry: {
          ...base, kind: "INFLOW", qtyChange: op.qty, valueChange: 0n, bookValue: 0n, costAdjustment: 0n, unitCostScaled: null, costBasis: op.basis, valuationStatus: "MISSING",
          unvaluedQtyChange: left, deficitQtyChange: -netted, coveredQty: netted, coveredWithoutCost: netted,
        },
      };
    }
    assertMinor(op.valueMinor, "inflow value");
    if (op.valueMinor < 0) throw new Error("an inflow value can't be negative");
    const V = BigInt(op.valueMinor);
    const q = BigInt(op.qty);
    // Units sold short come back first: their share of the value never enters stock (they are gone); the ledger received
    // it all, so the share is a cost adjustment — net of the provisional cost booked when they were issued (§15).
    const covered = Math.min(pos.deficitQty, op.qty);
    const coveredValue = covered === op.qty ? V : divRound(V * BigInt(covered), q);
    let left = covered;
    let coveredProvisional = 0n;
    let coveredUnbooked = 0n;
    let coveredWithoutCost = 0;
    const layers: DeficitLayer[] = [];
    for (const l of pos.deficitLayers) {
      if (left === 0) { layers.push(l); continue; }
      const take = Math.min(left, l.qty);
      left -= take;
      if (l.unitCostMinor === null) coveredWithoutCost += take;
      else coveredProvisional += BigInt(l.unitCostMinor) * BigInt(take);
      if (l.unbooked && l.unitCostMinor !== null) coveredUnbooked += BigInt(l.unitCostMinor) * BigInt(take);
      if (l.qty > take) layers.push({ ...l, qty: l.qty - take });
    }
    const rest = op.qty - covered;
    const next = withAverage({ ...pos, valuedQty: pos.valuedQty + rest, value: pos.value + (V - coveredValue), deficitQty: pos.deficitQty - covered, deficitLayers: layers }, scale);
    const valueChange = V - coveredValue;
    return {
      next,
      entry: {
        ...base, kind: "INFLOW", qtyChange: op.qty, valueChange, bookValue: V, costAdjustment: valueChange - V,
        unitCostScaled: divRound(V * scale, q), costBasis: op.basis, valuationStatus: op.status ?? "KNOWN",
        deficitQtyChange: -covered, coveredQty: covered, coveredProvisional, coveredWithoutCost, unbookedDeficitChange: -coveredUnbooked,
      },
    };
  }

  if (op.type === "OUTFLOW") {
    assertQty(op.qty, "outflow qty");
    const snapshot = op.basis.kind === "SNAPSHOT" ? op.basis.unitCostMinor : undefined;
    if (snapshot !== undefined && snapshot !== null) {
      assertMinor(snapshot, "snapshot unit cost");
      if (snapshot < 0) throw new Error("a unit cost can't be negative");
    }
    const v = Math.min(op.qty, pos.valuedQty);
    const u = Math.min(op.qty - v, pos.unvaluedQty);
    const d = op.qty - v - u;
    // Valued units leave at the line's own cost (so the valuation removes what the books will credit) — the whole remaining
    // value when the last valued unit goes (no residue), and at the average if a stale snapshot exceeded what is held.
    let outV = 0n;
    if (v > 0) {
      if (v === pos.valuedQty) outV = pos.value;
      else if (snapshot !== undefined && snapshot !== null && BigInt(snapshot) * BigInt(v) < pos.value) outV = BigInt(snapshot) * BigInt(v);
      else outV = divRound(pos.value * BigInt(v), BigInt(pos.valuedQty));
    }
    const avgMinor = pos.avgScaled === null ? null : Number(divRound(pos.avgScaled, scale));
    const provisional = op.basis.kind === "SNAPSHOT" ? snapshot ?? null : avgMinor;
    const unbooked = op.basis.kind === "SNAPSHOT" && op.basis.unbooked === true && provisional !== null;
    const layers = d > 0 ? [...pos.deficitLayers, unbooked ? { qty: d, unitCostMinor: provisional, unbooked: true as const } : { qty: d, unitCostMinor: provisional }] : pos.deficitLayers;
    const next = withAverage({ ...pos, valuedQty: pos.valuedQty - v, value: pos.value - outV, unvaluedQty: pos.unvaluedQty - u, deficitQty: pos.deficitQty + d, deficitLayers: layers }, scale);
    const valueChange = -outV;
    // What the ledger moves: an order line is credited at its snapshot for every unit (Phase 3); a write-off / supplier
    // return posts the valued amount plus the provisional cost of any units issued short; unvalued units carry nothing.
    const bookValue = op.basis.kind === "SNAPSHOT" ? -BigInt(snapshot ?? 0) * BigInt(op.qty) : -(outV + BigInt(provisional ?? 0) * BigInt(d));
    const status: FinanceValuationStatus = worst(
      op.basis.kind === "SNAPSHOT" && snapshot === null ? "MISSING" : "KNOWN",
      u > 0 ? "MISSING" : "KNOWN",
      d > 0 ? (provisional === null ? "MISSING" : "ESTIMATED") : "KNOWN",
    );
    return {
      next,
      entry: {
        ...base, kind: "OUTFLOW", qtyChange: -op.qty, valueChange, bookValue, costAdjustment: valueChange - bookValue,
        unitCostScaled: op.basis.kind === "SNAPSHOT" ? (snapshot === null ? null : BigInt(snapshot!) * scale) : pos.avgScaled,
        costBasis: op.basis.kind === "SNAPSHOT" ? "SNAPSHOT" : "AVERAGE", valuationStatus: status,
        deficitQtyChange: d, unvaluedQtyChange: -u, unbookedDeficitChange: unbooked ? BigInt(provisional!) * BigInt(d) : 0n,
      },
    };
  }

  // REVALUE
  assertMinor(op.deltaMinor, "revaluation");
  assertQty(op.qty, "revaluation qty");
  const D = BigInt(op.deltaMinor);
  const held = Math.min(op.qty, pos.valuedQty);
  let share = held === op.qty ? D : divRound(D * BigInt(held), BigInt(op.qty));
  if (pos.value + share < 0n) share = -pos.value; // a credit larger than what is held can't make the stock negative
  if (pos.valuedQty === 0) share = 0n;
  const next = withAverage({ ...pos, value: pos.value + share }, scale);
  return {
    next,
    entry: { ...base, kind: "REVALUATION", qtyChange: 0, valueChange: share, bookValue: D, costAdjustment: share - D, unitCostScaled: next.avgScaled, costBasis: "DOCUMENT", valuationStatus: "KNOWN" },
  };
}

/** The average as whole minor units (what an order line snapshots), or null when no cost has ever been known. */
export function averageUnitCostMinor(pos: Pick<CostPosition, "avgScaled">, currency: string): number | null {
  return pos.avgScaled === null ? null : Number(divRound(pos.avgScaled, avgScale(currency)));
}

// ── persistence (the only writer of the valuation tables) ────────────────────────────────────────────────────────
//
// Where the costing rules live: ONLY in `applyCostOperation` above (and `exitCost` below, which reads the average it
// keeps). The database function `finance_persist_valuations` is the persistence path for what this code computed — it
// performs no arithmetic and makes no costing decision; it writes the given entry, the given position and the given line
// cost in one round trip, so the stock row lock is held as briefly as possible. The guard triggers re-check every written
// row (continuity, position = latest entry, line cost = exit valuation), so it can never persist anything inconsistent.

const toBig = (d: Prisma.Decimal | string | number, digits: number) => BigInt(new Prisma.Decimal(d).mul(new Prisma.Decimal(10).pow(digits)).toFixed(0));
const scaledToDecimal = (v: bigint | null, decimals: number): string | null => {
  if (v === null) return null;
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(decimals + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
};
const minorToDecimal = (v: bigint, currency: string) => {
  const digits = minorDigits(currency);
  return digits === 0 ? v.toString() : scaledToDecimal(v, digits)!;
};

/** A position as stored (the InventoryCostState columns — also what the raw reads in this file and inventory.service return). */
export type StoredPosition = Pick<InventoryCostState, "valuedQty" | "unvaluedQty" | "deficitQty" | "deficitLayers"> & { value: Prisma.Decimal | string; avgUnitCost: Prisma.Decimal | string | null };

export function positionOf(row: StoredPosition | null, currency: string): CostPosition {
  if (!row) return EMPTY_POSITION;
  return {
    valuedQty: row.valuedQty,
    value: toBig(row.value, minorDigits(currency)),
    avgScaled: row.avgUnitCost === null ? null : toBig(row.avgUnitCost, AVG_DECIMALS),
    unvaluedQty: row.unvaluedQty,
    deficitQty: row.deficitQty,
    deficitLayers: (row.deficitLayers as unknown as DeficitLayer[]) ?? [],
  };
}

export type LineCostSource = "INVENTORY" | "INVENTORY_PROVISIONAL" | "NONE";

export interface ValuationInput {
  business: { id: string; baseCurrency: string };
  brandId: string;
  variantId: string;
  /** The authoritative stock movement this entry values (null only for revaluations and the cutover of a variant with no movement). */
  stockMovementId?: string | null;
  sourceType: string;
  sourceId: string;
  /** Business date (YYYY-MM-DD) the entry's accounting effect belongs to. */
  financialDate: string;
  note?: string | null;
  op: CostOperation;
  /** SNAPSHOT entries: the order line's exact unit cost in minor units (proved equal to the line by a database trigger). */
  unitCostMinor?: number | null;
  /** The variant's position as already read in this transaction while its row lock is held — skips a second lock and read. */
  position?: CostPosition;
  /** An order's stock exit: the order lines that take its cost, source and link, written in the same call. */
  lines?: { orderId: string; ids: string[]; unitCostSource: LineCostSource };
}

export interface ValuationResult {
  entryId: string;
  sequence: bigint;
  figures: CostEntryFigures;
  position: CostPosition;
}

/**
 * Records valuation entries and moves the variants' positions, in the caller's transaction: the engine computes every
 * figure here, then ONE database call persists them all (entry, position, and an exit's line cost). Concurrent movements of
 * a variant are serialised by its row lock — held by the caller's stock update, or taken here for callers that pass no
 * position (one statement), the position then read with a fresh snapshot.
 */
export async function recordValuationsInTx(tx: AppTransactionClient, inputs: ValuationInput[]): Promise<ValuationResult[]> {
  if (!inputs.length) return [];
  const cur = inputs[0]!.business.baseCurrency;
  const read = new Map<string, CostPosition>();
  const unread = [...new Set(inputs.filter((i) => !i.position).map((i) => i.variantId))].sort();
  if (unread.length) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ProductVariant" WHERE id IN (${Prisma.join(unread)}) ORDER BY id FOR UPDATE`;
    if (locked.length !== unread.length) throw financeError(404, "VARIANT_NOT_FOUND", "Variant not found");
    const rows = await tx.inventoryCostState.findMany({ where: { variantId: { in: unread } } });
    for (const id of unread) {
      const row = rows.find((r) => r.variantId === id) ?? null;
      if (row && row.businessId !== inputs[0]!.business.id) throw financeError(409, "COST_STATE_BUSINESS", "The variant's cost state belongs to another business");
      read.set(id, positionOf(row, cur));
    }
  }
  const chained = new Map<string, CostPosition>();
  const createdAt = new Date().toISOString();
  const results: ValuationResult[] = [];
  const items = inputs.map((input) => {
    const before = chained.get(input.variantId) ?? input.position ?? read.get(input.variantId) ?? EMPTY_POSITION;
    const { next, entry } = applyCostOperation(before, input.op, cur);
    chained.set(input.variantId, next);
    const id = randomUUID();
    const unitCostMinor = entry.costBasis === "SNAPSHOT" ? (input.unitCostMinor ?? null) : null;
    results.push({ entryId: id, sequence: 0n, figures: entry, position: next });
    return {
      entry: {
        id,
        businessId: input.business.id,
        brandId: input.brandId,
        variantId: input.variantId,
        stockMovementId: input.stockMovementId ?? null,
        kind: entry.kind,
        qtyChange: entry.qtyChange,
        valueChange: minorToDecimal(entry.valueChange, cur),
        bookValue: minorToDecimal(entry.bookValue, cur),
        costAdjustment: minorToDecimal(entry.costAdjustment, cur),
        unitCost: scaledToDecimal(entry.unitCostScaled, AVG_DECIMALS),
        unitCostMinor,
        costBasis: entry.costBasis,
        valuationStatus: entry.valuationStatus,
        deficitQtyChange: entry.deficitQtyChange,
        coveredQty: entry.coveredQty,
        unvaluedQtyChange: entry.unvaluedQtyChange,
        qtyAfter: next.valuedQty,
        valueAfter: minorToDecimal(next.value, cur),
        avgAfter: scaledToDecimal(next.avgScaled, AVG_DECIMALS),
        unvaluedAfter: next.unvaluedQty,
        deficitAfter: next.deficitQty,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        financialDate: input.financialDate,
        note: input.note ?? null,
        createdAt,
      },
      deficitLayers: next.deficitLayers,
      lines: input.lines ? { orderId: input.lines.orderId, ids: input.lines.ids, unitCostSnapshot: unitCostMinor, unitCostSource: input.lines.unitCostSource } : null,
    };
  });
  const persisted = await tx.$queryRaw<Array<{ entry_id: string; entry_sequence: bigint }>>`SELECT entry_id, entry_sequence FROM finance_persist_valuations(${JSON.stringify(items)}::jsonb)`;
  for (const [i, p] of persisted.entries()) results[i]!.sequence = BigInt(p.entry_sequence);
  return results;
}

/** One valuation entry (see recordValuationsInTx). */
export async function recordValuationInTx(tx: AppTransactionClient, input: ValuationInput): Promise<ValuationResult> {
  return (await recordValuationsInTx(tx, [input]))[0]!;
}

// ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function getCostPosition(variantId: string, currency: string): Promise<CostPosition> {
  return positionOf(await prisma.inventoryCostState.findUnique({ where: { variantId } }), currency);
}

// ── Phase 4B: costing integration (docs/FINANCE_PHASE_4.md §9) ───────────────────────────────────────────────────────
//
// inventory.service keeps sole ownership of physical quantity; it calls the functions below, in its own transaction, for
// every stock movement, after its stock update has taken the variants' row locks. Costing decides only VALUE: whether a
// variant is costed, what an order line's unit cost is at the stock exit, and each movement's valuation entry. The ledger
// effect goes to the Phase 1 engine as a financial event recorded in the same transaction (exactly-once by its key).

export interface CostingScope {
  business: { id: string; key: string; baseCurrency: string; timezone: string };
  brand: { id: string; key: string };
  activatedAt: Date;
}

/** Costing is active once the 4C valuation cutover activated it for this installation's books; null otherwise (and when
 * the books don't exist yet). Read in the caller's transaction, so a movement and the switch can't disagree. Needs no lock. */
export async function activeCostingInTx(tx: AppTransactionClient): Promise<CostingScope | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; key: string; baseCurrency: string; timezone: string; activatedAt: Date; brandId: string; brandKey: string }>>`
    SELECT b.id, b.key, b."baseCurrency", b.timezone, b."inventoryCostingActivatedAt" AS "activatedAt", br.id AS "brandId", br.key AS "brandKey"
    FROM "FinanceBusiness" b JOIN "FinanceBrand" br ON br."businessId" = b.id AND br."installId" = ${installId}
    WHERE b.key = ${FINANCE_BUSINESS_KEY} AND b."inventoryCostingActivatedAt" IS NOT NULL`;
  const r = rows[0];
  if (!r) return null;
  return { business: { id: r.id, key: r.key, baseCurrency: r.baseCurrency, timezone: r.timezone }, brand: { id: r.brandId, key: r.brandKey }, activatedAt: r.activatedAt };
}

/** A variant's costing facts as read under its row lock: whether it is costed, and its position. */
export interface VariantCosting {
  trackInventory: boolean;
  variantCreatedAt: Date;
  hasState: boolean;
  position: StoredPosition | null;
  /** The product is filled to order (docs/STOCK_HUB.md §3): its order exits beyond stock are unbooked deficits. */
  fillToOrder: boolean;
}

/**
 * The ONE costing-scope rule. A variant is costed when costing is active, its product is stock-tracked (untracked products
 * are never costed — locked decision 1), and it either has a valuation position (cut over in 4C, or costed since) or was
 * created after activation (its first movement starts its position).
 */
function inScope(v: VariantCosting, scope: CostingScope): boolean {
  return v.trackInventory && (v.hasState || v.variantCreatedAt >= scope.activatedAt);
}

/** Reads the variants' costing facts in one statement. The caller's stock update already holds the rows' locks (FOR UPDATE
 * here then waits for nothing; it only keeps the rule safe for a caller that didn't). */
async function readVariantCosting(tx: AppTransactionClient, variantIds: string[]): Promise<Map<string, VariantCosting>> {
  const ids = [...new Set(variantIds)].sort();
  if (!ids.length) return new Map();
  const rows = await tx.$queryRaw<Array<{ id: string; variantCreatedAt: Date; trackInventory: boolean; fillToOrder: boolean; hasState: boolean } & StoredPosition>>`
    SELECT v.id, v."createdAt" AS "variantCreatedAt", p."trackInventory", p."fillToOrder", s."variantId" IS NOT NULL AS "hasState",
           s."valuedQty", s.value, s."avgUnitCost", s."unvaluedQty", s."deficitQty", s."deficitLayers"
    FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" LEFT JOIN "InventoryCostState" s ON s."variantId" = v.id
    WHERE v.id IN (${Prisma.join(ids)}) ORDER BY v.id FOR UPDATE OF v`;
  return new Map(rows.map((r) => [r.id, { trackInventory: r.trackInventory, variantCreatedAt: r.variantCreatedAt, hasState: r.hasState, position: r.hasState ? r : null, fillToOrder: r.fillToOrder }]));
}

/**
 * Cost determination at the stock exit (locked decision §7), from the variant's position immediately before the exit —
 * read under the row lock the stock decrement holds: the moving average. INVENTORY when valued stock covers the units,
 * INVENTORY_PROVISIONAL when some leave beyond valued stock (a provisional cost, trued up through 5150 later), NONE when no
 * cost was ever known (never zero, never the catalog).
 *
 * A fill-to-order variant (`fillToOrder` given) sells beyond its filled bottles as its normal path, so EVERY unit it issues
 * beyond stock is an unbooked deficit (the fill that covers it posts only actual − provisional; nothing moves 5150 at the
 * sale, so a period end between sale and fill shifts no profit): at the moving average when it has one, else — never
 * valued — at its recipe's standard cost, else no cost. Units covered by valued stock leave as any exit does.
 */
function exitCost(position: CostPosition, qty: number, currency: string, fillToOrder?: { recipeMinor: number | null }): { unitCostMinor: number | null; source: LineCostSource; unbooked: boolean } {
  const unit = averageUnitCostMinor(position, currency);
  const source: LineCostSource = unit === null ? "NONE" : qty > position.valuedQty ? "INVENTORY_PROVISIONAL" : "INVENTORY";
  if (fillToOrder) {
    if (unit !== null) return { unitCostMinor: unit, source, unbooked: true };
    if (fillToOrder.recipeMinor !== null && position.unvaluedQty === 0) return { unitCostMinor: fillToOrder.recipeMinor, source: "INVENTORY_PROVISIONAL", unbooked: true };
  }
  return { unitCostMinor: unit, source, unbooked: false };
}

/** One line of a fill-to-order variant's recipe (latest APPROVED bill of materials, lines the business supplies). */
export interface RecipeCostLine { variantId: string; materialVariantId: string; qtyPerUnit: Prisma.Decimal; wastagePct: Prisma.Decimal }

/** The recipe lines of the given variants whose product is fill to order (docs/STOCK_HUB.md §3; the same recipe the
 * capacity engine reads). A line without a finished variant applies to every variant of the product. */
export async function fillToOrderRecipeLines(db: AppTransactionClient | typeof prisma, variantIds: string[]): Promise<RecipeCostLine[]> {
  if (!variantIds.length) return [];
  return db.$queryRaw<RecipeCostLine[]>`
    SELECT v.id AS "variantId", l."materialVariantId", l."qtyPerUnit", l."wastagePct"
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId" AND p."fillToOrder"
    JOIN LATERAL (SELECT b.id FROM "BillOfMaterials" b WHERE b."productId" = p.id AND b.status = 'APPROVED' ORDER BY b.version DESC LIMIT 1) b ON TRUE
    JOIN "BillOfMaterialsLine" l ON l."bomId" = b.id AND l."suppliedBy" = 'BUSINESS' AND (l."finishedVariantId" IS NULL OR l."finishedVariantId" = v.id)
    WHERE v.id IN (${Prisma.join(variantIds)})`;
}

/**
 * The recipe standard cost per unit, minor units: Σ qtyPerUnit × (1 + wastage% / 100) × the material's unit cost (major
 * units), rounded half to even once. null for a variant with no recipe line, or when any of its materials has no cost.
 */
export function recipeStandardCosts(lines: RecipeCostLine[], materialCost: (materialVariantId: string) => Prisma.Decimal | null, currency: string): Map<string, number | null> {
  const sums = new Map<string, Prisma.Decimal | null>();
  for (const l of lines) {
    if (sums.has(l.variantId) && sums.get(l.variantId) === null) continue;
    const unit = materialCost(l.materialVariantId);
    if (unit === null) { sums.set(l.variantId, null); continue; }
    const need = new Prisma.Decimal(l.qtyPerUnit).mul(new Prisma.Decimal(1).add(new Prisma.Decimal(l.wastagePct).div(100)));
    sums.set(l.variantId, (sums.get(l.variantId) ?? new Prisma.Decimal(0)).add(need.mul(unit)));
  }
  const factor = new Prisma.Decimal(10).pow(minorDigits(currency));
  return new Map([...sums].map(([id, v]) => [id, v === null ? null : v.mul(factor).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_EVEN).toNumber()]));
}

/** Recipe standard costs at the materials' current moving averages (null where a material has none). */
async function recipeCostsAtAverage(tx: AppTransactionClient, variantIds: string[], currency: string): Promise<Map<string, number | null>> {
  const lines = await fillToOrderRecipeLines(tx, variantIds);
  if (!lines.length) return new Map();
  const mats = [...new Set(lines.map((l) => l.materialVariantId))];
  const states = await tx.inventoryCostState.findMany({ where: { variantId: { in: mats } }, select: { variantId: true, avgUnitCost: true } });
  const avg = new Map(states.map((s) => [s.variantId, s.avgUnitCost]));
  return recipeStandardCosts(lines, (id) => avg.get(id) ?? null, currency);
}

/** Who books the movement's own value in the ledger. ORDER: the order's accounting (Phase 3, at the line's snapshot, when
 * the order is recognised) — this side posts only the cost adjustment. DOCUMENT: the stock document that moved it (a goods
 * receipt, a supplier return, a production document — Phase 4D+), which posts the book value the engine returns, in the
 * same transaction — this side posts only the cost adjustment. MOVEMENT: nobody else — this side posts it all. */
export type LedgerOwner = "ORDER" | "DOCUMENT" | "MOVEMENT";

export interface MovementToValue {
  movement: { id: string; variantId: string; change: number; reason: string; orderId: string | null; createdAt: Date };
  /** SNAPSHOT: an order line's own cost (outflow: the line's unit cost; inflow: units and their recorded costs, which may
   * differ per line — null cost = unvalued). AVERAGE: the running average (manual adjustments, write-offs, counts). */
  basis:
    | { kind: "SNAPSHOT"; unitCostMinor: number | null }
    /** An order's stock exit: the cost is determined HERE, under the stock row lock, and written to these order lines (the
     * lines created for this exit) together with the link to the exit. A costed exit without its lines is refused. */
    | { kind: "ORDER_EXIT"; orderItemIds: string[] }
    | { kind: "SNAPSHOT_LINES"; lines: Array<{ quantity: number; unitCostMinor: number | null }> }
    /** Units in at a document's value (a goods receipt, a production receipt): KNOWN unless stated. */
    | { kind: "DOCUMENT"; valueMinor: number; status?: "KNOWN" | "ESTIMATED" }
    | { kind: "AVERAGE" };
  ledger: LedgerOwner;
}

const COUNTER_FOR_REASON: Record<string, AccountMappingKey> = { DAMAGED: "cogs.inventory_shrinkage", LOST: "cogs.inventory_shrinkage", PACKAGING_USE: "cogs.packaging" };

function opFor(m: MovementToValue, position: CostPosition, currency: string, fillToOrder?: { recipeMinor: number | null }): { op: CostOperation; unitCostMinor: number | null; lineSource?: LineCostSource } {
  const qty = Math.abs(m.movement.change);
  if (m.basis.kind === "ORDER_EXIT") {
    if (!m.basis.orderItemIds.length) throw new Error(`COSTING_EXIT_UNLINKED: stock of costed variant ${m.movement.variantId} left for an order without the order lines to cost`);
    const c = exitCost(position, qty, currency, fillToOrder);
    return { op: { type: "OUTFLOW", qty, basis: { kind: "SNAPSHOT", unitCostMinor: c.unitCostMinor, ...(c.unbooked ? { unbooked: true } : {}) } }, unitCostMinor: c.unitCostMinor, lineSource: c.source };
  }
  if (m.basis.kind === "DOCUMENT") {
    if (m.movement.change < 0) throw new Error("a document value is an inflow; outflows leave at the average or a snapshot");
    return { op: { type: "INFLOW", qty, valueMinor: m.basis.valueMinor, basis: "DOCUMENT", status: m.basis.status ?? "KNOWN" }, unitCostMinor: null };
  }
  if (m.movement.change < 0) {
    if (m.basis.kind === "AVERAGE") return { op: { type: "OUTFLOW", qty, basis: { kind: "AVERAGE" } }, unitCostMinor: null };
    if (m.basis.kind === "SNAPSHOT_LINES") throw new Error("an outflow leaves at one unit cost");
    return { op: { type: "OUTFLOW", qty, basis: { kind: "SNAPSHOT", unitCostMinor: m.basis.unitCostMinor } }, unitCostMinor: m.basis.unitCostMinor };
  }
  if (m.basis.kind === "AVERAGE") {
    // Units found (count gain, manual restock outside purchasing): at the current average, labelled ESTIMATED — never a
    // purchase cost, never the catalog; with no average ever known they are held unvalued (MISSING).
    if (position.avgScaled === null) return { op: { type: "INFLOW", qty, valueMinor: null, basis: "AVERAGE" }, unitCostMinor: null };
    return { op: { type: "INFLOW", qty, valueMinor: Number(divRound(position.avgScaled * BigInt(qty), avgScale(currency))), basis: "AVERAGE", status: "ESTIMATED" }, unitCostMinor: null };
  }
  const lines = m.basis.kind === "SNAPSHOT" ? [{ quantity: qty, unitCostMinor: m.basis.unitCostMinor }] : m.basis.lines;
  if (lines.reduce((n, l) => n + l.quantity, 0) !== qty) throw new Error("returned lines don't add up to the movement");
  const unvaluedQty = lines.filter((l) => l.unitCostMinor === null).reduce((n, l) => n + l.quantity, 0);
  const valueMinor = lines.reduce((v, l) => v + (l.unitCostMinor ?? 0) * l.quantity, 0);
  const single = new Set(lines.map((l) => l.unitCostMinor)).size === 1 ? lines[0]!.unitCostMinor : null;
  return {
    op: unvaluedQty === qty ? { type: "INFLOW", qty, valueMinor: null, basis: "SNAPSHOT" } : { type: "INFLOW", qty, valueMinor, basis: "SNAPSHOT", ...(unvaluedQty ? { unvaluedQty } : {}) },
    unitCostMinor: single,
  };
}

/**
 * Values stock movements just written by inventory.service, in its transaction (atomic with the stock change), after its
 * stock update took the variants' row locks. Movements of variants outside costing are left alone. For each valued
 * movement: one valuation entry (1:1 with the movement) — all persisted in one call — and, when the ledger must move, one
 * `inventory.valued` financial event in the same transaction, posted by the Phase 1 engine exactly once.
 * `known` lets the caller pass costing facts it already read under the lock (recordSale reads them with its movement
 * insert), so the lock is held for no extra read.
 */
export async function valueStockMovementsInTx(
  tx: AppTransactionClient,
  movements: MovementToValue[],
  knownScope?: CostingScope | null,
  known?: Map<string, VariantCosting>,
): Promise<Map<string, ValuationResult>> {
  const out = new Map<string, ValuationResult>();
  if (!movements.length) return out;
  const scope = knownScope === undefined ? await activeCostingInTx(tx) : knownScope;
  if (!scope) return out;
  const facts = known ?? (await readVariantCosting(tx, movements.map((m) => m.movement.variantId)));
  const cur = scope.business.baseCurrency;
  const positions = new Map<string, CostPosition>();
  for (const [id, v] of facts) if (inScope(v, scope)) positions.set(id, positionOf(v.position, cur));
  // Order exits of fill-to-order variants: their deficits are unbooked; one never valued (no average) takes its recipe's
  // standard cost.
  const fillToOrder = new Set([...new Set(movements.filter((m) => m.basis.kind === "ORDER_EXIT" && m.movement.change < 0).map((m) => m.movement.variantId))]
    .filter((id) => positions.has(id) && facts.get(id)!.fillToOrder));
  const neverValued = [...fillToOrder].filter((id) => { const p = positions.get(id)!; return p.avgScaled === null && p.unvaluedQty === 0; });
  const recipe = neverValued.length ? await recipeCostsAtAverage(tx, neverValued.sort(), cur) : new Map<string, number | null>();

  // A variant appears at most once per persisted batch (its next movement needs the position this one produces).
  let batch: Array<{ m: MovementToValue; input: ValuationInput }> = [];
  const flush = async () => {
    if (!batch.length) return;
    const results = await recordValuationsInTx(tx, batch.map((b) => b.input));
    for (const [i, r] of results.entries()) {
      const { m } = batch[i]!;
      positions.set(m.movement.variantId, r.position);
      out.set(m.movement.id, r);
      await postValuation(tx, scope, m, r);
    }
    batch = [];
  };
  for (const m of movements) {
    if (m.movement.change === 0 || !positions.has(m.movement.variantId)) continue;
    if (batch.some((b) => b.m.movement.variantId === m.movement.variantId)) await flush();
    const position = positions.get(m.movement.variantId)!;
    const { op, unitCostMinor, lineSource } = opFor(m, position, cur, fillToOrder.has(m.movement.variantId) ? { recipeMinor: recipe.get(m.movement.variantId) ?? null } : undefined);
    const financialDate = businessDate(m.movement.createdAt < scope.activatedAt ? scope.activatedAt : m.movement.createdAt, scope.business.timezone);
    batch.push({
      m,
      input: {
        business: { id: scope.business.id, baseCurrency: cur },
        brandId: scope.brand.id,
        variantId: m.movement.variantId,
        stockMovementId: m.movement.id,
        sourceType: "StockMovement",
        sourceId: m.movement.id,
        financialDate,
        note: `${m.movement.reason}${m.movement.orderId ? ` order ${m.movement.orderId}` : ""}`,
        op,
        unitCostMinor,
        position,
        ...(m.basis.kind === "ORDER_EXIT" ? { lines: { orderId: m.movement.orderId ?? "", ids: m.basis.orderItemIds, unitCostSource: lineSource! } } : {}),
      },
    });
  }
  await flush();
  return out;
}

/** The ledger side of a valuation entry, when there is one: the movement's own value (MOVEMENT-owned) and the cost
 * adjustment, as one `inventory.valued` event recorded in the same transaction. Nothing when both are zero. */
async function postValuation(tx: AppTransactionClient, scope: CostingScope, m: MovementToValue, result: ValuationResult) {
  const bookMinor = m.ledger === "MOVEMENT" ? Number(result.figures.bookValue) : 0;
  const adjustmentMinor = Number(result.figures.costAdjustment);
  const unbookedMinor = Number(result.figures.unbookedDeficitChange);
  if (bookMinor === 0 && adjustmentMinor === 0 && unbookedMinor === 0) return;
  const financialDate = businessDate(m.movement.createdAt < scope.activatedAt ? scope.activatedAt : m.movement.createdAt, scope.business.timezone);
  await recordFinancialEvent(tx, {
    contract: "finance.event",
    contractVersion: 1,
    businessKey: scope.business.key,
    brandKey: scope.brand.key,
    source: { installId, system: "inventory", entityType: "InventoryValuationEntry", entityId: result.entryId },
    event: { type: INVENTORY_VALUED_EVENT, version: 1, key: `valuation:${result.entryId}`, occurredAt: m.movement.createdAt.toISOString() },
    financialDate,
    currency: scope.business.baseCurrency,
    payload: {
      entryId: result.entryId,
      movementId: m.movement.id,
      variantId: m.movement.variantId,
      reason: m.movement.reason,
      orderId: m.movement.orderId,
      bookMinor,
      counterKey: m.ledger === "MOVEMENT" ? (COUNTER_FOR_REASON[m.movement.reason] ?? "cogs.count_adjustments") : null,
      costAdjustmentMinor: adjustmentMinor,
      ...(unbookedMinor ? { unbookedDeficitChangeMinor: unbookedMinor } : {}),
      status: result.figures.valuationStatus,
    },
  });
}

/**
 * A value change for units a document brought in earlier (a production order's final cost at close; later, a supplier
 * invoice's price difference or landed cost) — locked decision 11, no history rewritten. For each variant, REVALUE: the
 * share still held revalues the stock (and its average); the share already sold becomes a cost adjustment, posted HERE as
 * an `inventory.valued` event (inventory against 5150). The document books `deltaMinor` itself (Dr/Cr inventory against
 * its own account), so the inventory account ends equal to the valuation. One valuation entry per variant, in the caller's
 * transaction (variants locked in id order).
 */
export async function revalueForDocumentInTx(
  tx: AppTransactionClient,
  input: {
    scope: CostingScope;
    sourceType: string;
    sourceId: string;
    financialDate: string;
    note?: string | null;
    items: Array<{ variantId: string; deltaMinor: number; qty: number }>;
  },
): Promise<Array<{ variantId: string; entryId: string; heldShareMinor: number; soldShareMinor: number }>> {
  const items = input.items.filter((i) => i.deltaMinor !== 0).sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
  if (!items.length) return [];
  const results = await recordValuationsInTx(tx, items.map((i) => ({
    business: { id: input.scope.business.id, baseCurrency: input.scope.business.baseCurrency },
    brandId: input.scope.brand.id,
    variantId: i.variantId,
    stockMovementId: null,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    financialDate: input.financialDate,
    note: input.note ?? null,
    op: { type: "REVALUE" as const, deltaMinor: i.deltaMinor, qty: i.qty },
  })));
  const out = [];
  for (const [k, r] of results.entries()) {
    const adjustment = Number(r.figures.costAdjustment);
    if (adjustment !== 0) {
      await recordFinancialEvent(tx, {
        contract: "finance.event",
        contractVersion: 1,
        businessKey: input.scope.business.key,
        brandKey: input.scope.brand.key,
        source: { installId, system: "inventory", entityType: "InventoryValuationEntry", entityId: r.entryId },
        event: { type: INVENTORY_VALUED_EVENT, version: 1, key: `valuation:${r.entryId}`, occurredAt: new Date().toISOString() },
        financialDate: input.financialDate,
        currency: input.scope.business.baseCurrency,
        payload: { entryId: r.entryId, movementId: `${input.sourceType}:${input.sourceId}`, variantId: items[k]!.variantId, reason: "REVALUATION", orderId: null, bookMinor: 0, counterKey: null, costAdjustmentMinor: adjustment, status: r.figures.valuationStatus },
      });
    }
    out.push({ variantId: items[k]!.variantId, entryId: r.entryId, heldShareMinor: Number(r.figures.valueChange), soldShareMinor: -adjustment });
  }
  return out;
}

/**
 * Activates inventory costing for this installation's books from `at` — a one-way switch (database trigger). Phase 4C's
 * approved valuation cutover is the only production caller; 4B uses it in tests and the benchmark. Audited.
 */
export async function activateInventoryCostingInTx(tx: AppTransactionClient, businessId: string, at: Date, actor: FinanceActor) {
  const before = await tx.financeBusiness.findUniqueOrThrow({ where: { id: businessId } });
  if (before.inventoryCostingActivatedAt) return before.inventoryCostingActivatedAt;
  if (!before.openingDate) throw financeError(409, "COSTING_NEEDS_OPENING_DATE", "Set the Financial Opening Date before activating inventory costing");
  if (at < before.openingDate) throw financeError(409, "COSTING_BEFORE_OPENING", "Costing can't start before the books do");
  await tx.financeBusiness.update({ where: { id: businessId }, data: { inventoryCostingActivatedAt: at } });
  await recordFinanceAudit(tx, { businessId, actor, action: "business.inventory_costing_activated", entityType: "FinanceBusiness", entityId: businessId, before: { inventoryCostingActivatedAt: null }, after: { inventoryCostingActivatedAt: at } });
  return at;
}
