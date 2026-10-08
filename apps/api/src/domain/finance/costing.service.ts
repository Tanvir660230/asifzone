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
 * Every entry states `valueChange` (what the valuation moved) and `bookValue` (what the ledger's inventory account moves for
 * the same fact, posted by that fact's owner: Phase 3 for order-linked units at the line snapshot, Phase 4 documents
 * otherwise). `costAdjustment = valueChange − bookValue` is posted to inventory against 5150 Inventory cost adjustments, so
 * the ledger equals the valuation after every entry. Deficit cover, rounding at zero, late price differences and landed
 * costs on sold units are all this one rule — no journal is ever rewritten.
 *
 * 4A: the engine and its writer exist; inventory.service does not call them yet (Phase 4B wires and activates costing).
 */
import { Prisma, type FinanceValuationStatus, type InventoryCostState, type InventoryValuationKind } from "@prisma/client";
import { minorDigits } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { dateColumn, financeError } from "./finance-values";

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
  | { type: "INFLOW"; qty: number; valueMinor: number | null; basis: Exclude<CostBasis, "CUTOVER">; status?: Extract<FinanceValuationStatus, "KNOWN" | "ESTIMATED"> }
  /** Units out. SNAPSHOT: an order line's own unit cost (null = the line has none); AVERAGE: at the running average. */
  | { type: "OUTFLOW"; qty: number; basis: { kind: "SNAPSHOT"; unitCostMinor: number | null } | { kind: "AVERAGE" } }
  /** A value change (late invoice difference, landed cost) for `qty` units received earlier: the share still held revalues
   * the stock, the rest (sold) becomes a cost adjustment. */
  | { type: "REVALUE"; deltaMinor: number; qty: number }
  /** The one-time cutover: the variant's first entry. qty = its physical stock (may be ≤ 0); valueMinor null = no cost. */
  | { type: "CUTOVER"; qty: number; valueMinor: number | null; status?: Extract<FinanceValuationStatus, "KNOWN" | "ESTIMATED"> };

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
  const base = { coveredQty: 0, coveredProvisional: 0n, coveredWithoutCost: 0, deficitQtyChange: 0, unvaluedQtyChange: 0 };

  if (op.type === "CUTOVER") {
    if (pos !== EMPTY_POSITION && (pos.valuedQty || pos.unvaluedQty || pos.deficitQty || pos.value || pos.avgScaled !== null)) throw new Error("a cutover is only a variant's first valuation");
    if (!Number.isSafeInteger(op.qty)) throw new Error("cutover qty must be a whole number");
    if (op.valueMinor !== null) assertMinor(op.valueMinor, "cutover value");
    if (op.qty <= 0 && op.valueMinor) throw new Error("a cutover with no units on hand carries no value");
    if (op.valueMinor !== null && op.valueMinor < 0) throw new Error("a cutover value can't be negative");
    const valued = op.qty > 0 && op.valueMinor !== null;
    const next = withAverage({
      valuedQty: valued ? op.qty : 0,
      value: valued ? BigInt(op.valueMinor!) : 0n,
      avgScaled: null,
      unvaluedQty: op.qty > 0 && !valued ? op.qty : 0,
      deficitQty: op.qty < 0 ? -op.qty : 0,
      deficitLayers: op.qty < 0 ? [{ qty: -op.qty, unitCostMinor: null }] : [],
    }, scale);
    const valueChange = next.value;
    return {
      next,
      entry: {
        ...base, kind: "CUTOVER", qtyChange: op.qty, valueChange, bookValue: valueChange, costAdjustment: 0n,
        unitCostScaled: next.avgScaled, costBasis: "CUTOVER",
        valuationStatus: op.qty > 0 && !valued ? "MISSING" : op.qty < 0 ? "MISSING" : (op.status ?? "KNOWN"),
        deficitQtyChange: next.deficitQty, unvaluedQtyChange: next.unvaluedQty,
      },
    };
  }

  if (op.type === "INFLOW") {
    assertQty(op.qty, "inflow qty");
    if (op.valueMinor === null) {
      // No cost known: the units are held unvalued — never at zero cost, and they don't settle a deficit (whose true cost
      // would still be unknown).
      const next = { ...pos, unvaluedQty: pos.unvaluedQty + op.qty };
      return { next, entry: { ...base, kind: "INFLOW", qtyChange: op.qty, valueChange: 0n, bookValue: 0n, costAdjustment: 0n, unitCostScaled: null, costBasis: op.basis, valuationStatus: "MISSING", unvaluedQtyChange: op.qty } };
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
    let coveredWithoutCost = 0;
    const layers: DeficitLayer[] = [];
    for (const l of pos.deficitLayers) {
      if (left === 0) { layers.push(l); continue; }
      const take = Math.min(left, l.qty);
      left -= take;
      if (l.unitCostMinor === null) coveredWithoutCost += take;
      else coveredProvisional += BigInt(l.unitCostMinor) * BigInt(take);
      if (l.qty > take) layers.push({ qty: l.qty - take, unitCostMinor: l.unitCostMinor });
    }
    const rest = op.qty - covered;
    const next = withAverage({ ...pos, valuedQty: pos.valuedQty + rest, value: pos.value + (V - coveredValue), deficitQty: pos.deficitQty - covered, deficitLayers: layers }, scale);
    const valueChange = V - coveredValue;
    return {
      next,
      entry: {
        ...base, kind: "INFLOW", qtyChange: op.qty, valueChange, bookValue: V, costAdjustment: valueChange - V,
        unitCostScaled: divRound(V * scale, q), costBasis: op.basis, valuationStatus: op.status ?? "KNOWN",
        deficitQtyChange: -covered, coveredQty: covered, coveredProvisional, coveredWithoutCost,
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
    const layers = d > 0 ? [...pos.deficitLayers, { qty: d, unitCostMinor: provisional }] : pos.deficitLayers;
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
        deficitQtyChange: d, unvaluedQtyChange: -u,
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

const toBig = (d: Prisma.Decimal, digits: number) => BigInt(d.mul(new Prisma.Decimal(10).pow(digits)).toFixed(0));
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

function positionOf(row: InventoryCostState | null, currency: string): CostPosition {
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
}

export interface ValuationResult {
  entryId: string;
  sequence: bigint;
  figures: CostEntryFigures;
  position: CostPosition;
}

/**
 * Records one valuation entry and moves the variant's cost state, in the caller's transaction. Serialised per variant by
 * the variant's row lock (the same lock inventory.service's stock update takes), so concurrent movements of one variant
 * are costed one after the other in a single, deterministic order.
 */
export async function recordValuationInTx(tx: AppTransactionClient, input: ValuationInput): Promise<ValuationResult> {
  const cur = input.business.baseCurrency;
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ProductVariant" WHERE id = ${input.variantId} FOR UPDATE`;
  if (!locked.length) throw financeError(404, "VARIANT_NOT_FOUND", "Variant not found");
  const row = await tx.inventoryCostState.findUnique({ where: { variantId: input.variantId } });
  if (row && row.businessId !== input.business.id) throw financeError(409, "COST_STATE_BUSINESS", "The variant's cost state belongs to another business");
  const { next, entry } = applyCostOperation(positionOf(row, cur), input.op, cur);
  const created = await tx.inventoryValuationEntry.create({
    data: {
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
      financialDate: dateColumn(input.financialDate),
      note: input.note ?? null,
    },
  });
  const state = {
    valuedQty: next.valuedQty,
    value: minorToDecimal(next.value, cur),
    avgUnitCost: scaledToDecimal(next.avgScaled, AVG_DECIMALS),
    unvaluedQty: next.unvaluedQty,
    deficitQty: next.deficitQty,
    deficitLayers: next.deficitLayers as unknown as Prisma.InputJsonValue,
    lastEntryId: created.id,
  };
  if (row) await tx.inventoryCostState.update({ where: { variantId: input.variantId }, data: state });
  else await tx.inventoryCostState.create({ data: { variantId: input.variantId, businessId: input.business.id, ...state } });
  return { entryId: created.id, sequence: created.sequence, figures: entry, position: next };
}

// ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function getCostPosition(variantId: string, currency: string): Promise<CostPosition> {
  return positionOf(await prisma.inventoryCostState.findUnique({ where: { variantId } }), currency);
}
