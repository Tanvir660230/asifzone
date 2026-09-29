import { add, clampNonNegative, min, subtract, zero, type Money } from "./money";

/**
 * The ONLY implementation of an order's final total (docs/PRICING_INVARIANTS.md §6). Every caller — the quote, order
 * creation, the admin price adjustment — passes already-resolved components; none re-derives the formula.
 *
 *   total = subtotal − discount + shippingCharged + taxAdded + priceAdjustment
 *   discount = min(bundleDiscount + couponDiscount, subtotal)
 */
export interface OrderTotalsInput {
  /** Σ line amounts after flash pricing (post-flash merchandise). */
  subtotal: Money;
  bundleDiscount: Money;
  couponDiscount: Money;
  /** Shipping actually charged (0 when waived). */
  shippingCharged: Money;
  /** Tax added on top — 0 for tax-inclusive pricing. */
  taxAdded: Money;
  /** Signed admin adjustment (0 at checkout). */
  priceAdjustment: Money;
}

export interface OrderTotals {
  subtotal: Money;
  discount: Money;
  /** subtotal − discount: the merchandise value after discounts (the loyalty base, D8). */
  merchandiseTotal: Money;
  shippingCharged: Money;
  taxAdded: Money;
  priceAdjustment: Money;
  total: Money;
  /** True when the components would produce a negative total (callers must refuse it, never charge it). */
  negative: boolean;
}

export function computeOrderTotals(i: OrderTotalsInput): OrderTotals {
  const discount = clampNonNegative(min(add(i.bundleDiscount, i.couponDiscount), i.subtotal));
  const merchandiseTotal = subtract(i.subtotal, discount);
  const raw = add(add(add(merchandiseTotal, i.shippingCharged), i.taxAdded), i.priceAdjustment);
  return {
    subtotal: i.subtotal,
    discount,
    merchandiseTotal,
    shippingCharged: i.shippingCharged,
    taxAdded: i.taxAdded,
    priceAdjustment: i.priceAdjustment,
    total: raw.amount < 0 ? zero(raw.currency) : raw,
    negative: raw.amount < 0,
  };
}
