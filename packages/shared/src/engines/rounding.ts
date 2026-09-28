import { minorPerMajor, money, type Money } from "./money";

/**
 * The centralised rounding policy (docs/PRICING_INVARIANTS.md §2). Every fractional result in the pricing pipeline is
 * rounded here, half-up, with integer arithmetic only — never `Math.round(float)` on a money value.
 *
 * The defaults reproduce the behaviour the store has always had: flash-sale unit prices keep paisa, percentage coupon
 * and bundle discounts are whole taka, VAT keeps paisa.
 */
export type RoundingUnit = "MINOR" | "MAJOR";

export interface RoundingPolicy {
  /** A flash-sale unit price (percentage or fixed off the list price). */
  flashPrice: RoundingUnit;
  /** A percentage coupon or bundle discount. */
  percentDiscount: RoundingUnit;
  /** A VAT amount. */
  tax: RoundingUnit;
}

export const DEFAULT_ROUNDING_POLICY: RoundingPolicy = { flashPrice: "MINOR", percentDiscount: "MAJOR", tax: "MINOR" };

/** round(numerator / denominator), half away from zero, integers only. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0 || !Number.isInteger(denominator)) throw new RangeError("Denominator must be a positive integer");
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  return sign * Math.floor((2 * n + denominator) / (2 * denominator));
}

/** A percentage as integer basis points (12.5% → 1250). Rates are stored with at most 2 decimals. */
export function toBasisPoints(pct: number): number {
  return Math.round(pct * 100);
}

/** Rounds a minor-unit amount to the policy unit (MAJOR = whole taka). */
export function roundToUnit(amountMinor: number, unit: RoundingUnit, currency: string): number {
  if (unit === "MINOR") return amountMinor;
  const per = minorPerMajor(currency);
  return divRoundHalfUp(amountMinor, per) * per;
}

/** `pct`% of `m`, rounded half-up to `unit`. Integer arithmetic via basis points. */
export function percentOf(m: Money, pct: number, unit: RoundingUnit): Money {
  const bp = toBasisPoints(pct);
  const raw = divRoundHalfUp(m.amount * bp, 10_000);
  return money(roundToUnit(raw, unit, m.currency), m.currency);
}

/** The tax contained in a tax-inclusive gross amount: gross × r / (100 + r). */
export function inclusiveTaxOf(gross: Money, ratePct: number, unit: RoundingUnit): Money {
  const bp = toBasisPoints(ratePct);
  if (bp <= 0) return money(0, gross.currency);
  const raw = divRoundHalfUp(gross.amount * bp, 10_000 + bp);
  return money(roundToUnit(raw, unit, gross.currency), gross.currency);
}

/** Tax added on top of a tax-exclusive net amount: net × r / 100. */
export function exclusiveTaxOf(net: Money, ratePct: number, unit: RoundingUnit): Money {
  return percentOf(net, ratePct, unit);
}

const ZERO_BIG = BigInt(0);
const ONE_BIG = BigInt(1);

/**
 * Splits `total` across `weights` proportionally (largest-remainder method), so the parts always sum exactly to the
 * total — used to allocate an order-level discount to lines. Ties go to the earlier index (deterministic).
 */
export function allocateProportionally(total: Money, weights: number[]): Money[] {
  const cur = total.currency;
  const ws = weights.map((w) => BigInt(Math.max(0, Math.trunc(w))));
  const weightSum = ws.reduce((a, b) => a + b, ZERO_BIG);
  if (weightSum === ZERO_BIG || total.amount === 0) return weights.map(() => money(0, cur));
  // Exact integer arithmetic: quotient + remainder per weight, then hand out the leftover units by largest remainder.
  const t = BigInt(total.amount);
  const parts = ws.map((w, i) => ({ i, q: (t * w) / weightSum, r: (t * w) % weightSum }));
  let leftover = t - parts.reduce((a, p) => a + p.q, ZERO_BIG);
  const order = [...parts].sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const p of order) {
    if (leftover <= ZERO_BIG) break;
    p.q += ONE_BIG;
    leftover -= ONE_BIG;
  }
  return parts.map((p) => money(Number(p.q), cur));
}
