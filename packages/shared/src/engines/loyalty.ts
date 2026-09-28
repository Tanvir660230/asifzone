/**
 * D8 — the rewardable merchandise value of an order (docs/PRICING_INVARIANTS.md §9, PI-9.4). The ONE definition:
 *
 *   rewardable = merchandise subtotal − bundle discount − coupon discount   (never below zero)
 *
 * Its inputs are merchandise snapshot figures only, so shipping, shipping VAT, tax and the admin price adjustment can't
 * enter it: there is no parameter for them. An exchange replacement order also subtracts the exchange credit (the value
 * of the returned item, already rewarded on the original order), so an exchange never earns the same merchandise twice.
 */
import { clampNonNegative, subtract, zero, type Money } from "./money";

export interface RewardableInput {
  /** Merchandise subtotal after flash sales (`Order.subtotal`). */
  subtotal: Money;
  bundleDiscount: Money;
  couponDiscount: Money;
  /** Exchange orders only: the returned item's value applied as credit. */
  exchangeCredit?: Money;
}

export function rewardableMerchandiseValue(input: RewardableInput): Money {
  const credit = input.exchangeCredit ?? zero(input.subtotal.currency);
  return clampNonNegative(subtract(subtract(subtract(input.subtotal, input.bundleDiscount), input.couponDiscount), credit));
}
