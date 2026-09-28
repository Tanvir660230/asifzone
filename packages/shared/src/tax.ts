/** Storefront prices are tax-inclusive (decision D3, docs/PRICING_PIPELINE.md §3): an amount already contains
 * its VAT. These are the only implementations of the inclusive split — never add tax on top of a price. */

/** The VAT contained in a tax-inclusive `amount` at `ratePct` percent: amount × r / (100 + r). */
export function taxIncludedIn(amount: number, ratePct: number): number {
  if (!(ratePct > 0) || !Number.isFinite(amount)) return 0;
  return (amount * ratePct) / (100 + ratePct);
}

/** The taxable (net-of-VAT) part of a tax-inclusive amount. */
export function amountExcludingTax(amount: number, ratePct: number): number {
  return amount - taxIncludedIn(amount, ratePct);
}
