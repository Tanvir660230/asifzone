import { fromMajor, toMajor } from "./engines/money";
import { inclusiveTaxOf } from "./engines/rounding";

/** Storefront prices are tax-inclusive (decision D3, docs/PRICING_PIPELINE.md §3): an amount already contains its VAT.
 * Number-in/number-out conveniences over the tax engine's single inclusive formula (engines/rounding.ts
 * `inclusiveTaxOf`, used by engines/tax.ts `computeTax`) — never a second implementation. */

/** The VAT contained in a tax-inclusive major-unit `amount` at `ratePct` percent: amount × r / (100 + r), to the paisa. */
export function taxIncludedIn(amount: number, ratePct: number, currency = "BDT"): number {
  if (!(ratePct > 0) || !Number.isFinite(amount)) return 0;
  return toMajor(inclusiveTaxOf(fromMajor(amount, currency), ratePct, "MINOR"));
}

/** The taxable (net-of-VAT) part of a tax-inclusive amount. */
export function amountExcludingTax(amount: number, ratePct: number, currency = "BDT"): number {
  return toMajor(fromMajor(amount, currency)) - taxIncludedIn(amount, ratePct, currency);
}
