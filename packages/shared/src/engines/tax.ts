import { add, money, subtract, type Money } from "./money";
import { exclusiveTaxOf, inclusiveTaxOf, type RoundingPolicy } from "./rounding";

/**
 * The one tax calculation (D3, D10 — docs/PRICING_INVARIANTS.md §5). Prices are tax-INCLUSIVE by default: the VAT is
 * already inside the price and is extracted as gross × r / (100 + r). EXCLUSIVE mode adds net × r / 100 on top. Shipping
 * is VAT-inclusive by default at the store rate; whether shipping is taxable and at which rate comes only from this
 * configuration — no other code computes shipping VAT.
 */
export type TaxMode = "INCLUSIVE" | "EXCLUSIVE";

/** The centralised tax configuration (the `TaxSetting` row), normalised. */
export interface TaxConfig {
  enabled: boolean;
  mode: TaxMode;
  /** Store rate in percent (e.g. 15). */
  ratePct: number;
  /** D10: shipping carries VAT (inclusive/exclusive per `mode`). */
  shippingTaxable: boolean;
  /** Shipping rate override in percent; null = the store rate. */
  shippingRatePct: number | null;
}

export interface TaxPart {
  /** The amount taxed, as charged (gross in INCLUSIVE mode, net in EXCLUSIVE). */
  base: Money;
  /** Net of VAT. */
  taxableAmount: Money;
  taxAmount: Money;
  ratePct: number;
}

export interface TaxResult {
  mode: TaxMode;
  inclusive: boolean;
  /** The merchandise rate actually applied (0 when tax is disabled). */
  ratePct: number;
  merchandise: TaxPart;
  shipping: TaxPart;
  /** merchandise + shipping net amounts. */
  taxableAmount: Money;
  /** merchandise + shipping VAT. */
  taxAmount: Money;
  /** What tax adds to the total: 0 when inclusive (already in the prices), taxAmount when exclusive. */
  addedToTotal: Money;
}

export const DEFAULT_TAX_CONFIG: TaxConfig = { enabled: false, mode: "INCLUSIVE", ratePct: 0, shippingTaxable: true, shippingRatePct: null };

function part(base: Money, ratePct: number, mode: TaxMode, rounding: RoundingPolicy): TaxPart {
  if (ratePct <= 0 || base.amount <= 0) return { base, taxableAmount: base, taxAmount: money(0, base.currency), ratePct: Math.max(0, ratePct) };
  if (mode === "INCLUSIVE") {
    const taxAmount = inclusiveTaxOf(base, ratePct, rounding.tax);
    return { base, taxableAmount: subtract(base, taxAmount), taxAmount, ratePct };
  }
  return { base, taxableAmount: base, taxAmount: exclusiveTaxOf(base, ratePct, rounding.tax), ratePct };
}

/**
 * Tax on the merchandise after discounts and on the shipping actually charged. Returns explicit components so the
 * order can snapshot mode, rate, taxable amount and tax amount (historical invoices never read current settings).
 */
export function computeTax(config: TaxConfig, merchandise: Money, shipping: Money, rounding: RoundingPolicy): TaxResult {
  const rate = config.enabled ? config.ratePct : 0;
  const shippingRate = config.enabled && config.shippingTaxable ? (config.shippingRatePct ?? config.ratePct) : 0;
  const m = part(merchandise, rate, config.mode, rounding);
  const s = part(shipping, shippingRate, config.mode, rounding);
  const taxAmount = add(m.taxAmount, s.taxAmount);
  return {
    mode: config.mode,
    inclusive: config.mode === "INCLUSIVE",
    ratePct: rate,
    merchandise: m,
    shipping: s,
    taxableAmount: add(m.taxableAmount, s.taxableAmount),
    taxAmount,
    addedToTotal: config.mode === "INCLUSIVE" ? money(0, merchandise.currency) : taxAmount,
  };
}
