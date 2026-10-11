import { clampNonNegative, fromMajor, min, subtract, sum, toMajor, zero, type Money } from "./money";
import { allocateProportionally, percentOf, type RoundingPolicy } from "./rounding";
import { formatMoney } from "../format";

/**
 * Promotions after unit pricing (docs/PRICING_PIPELINE.md, D9): the bundle discount is computed first on the
 * post-flash line amounts (D2), then the coupon on what remains of its eligible lines. Pure and deterministic.
 */

/** A priced line as promotions see it (one per cart item; flash/regular segments already folded into `amount`). */
export interface PromoLine {
  key: string;
  productId: string;
  categoryId: string;
  quantity: number;
  /** Post-flash line amount. */
  amount: Money;
}

// --- bundles -----------------------------------------------------------------------------------

export interface BundleRule {
  id: string;
  name: string;
  anchorCategoryId: string;
  suggestionCategoryIds: string[];
  minSuggestedCategories: number;
  discountType: "PERCENTAGE" | "FIXED" | "FREE_SHIPPING";
  /** Percent, or a major-unit amount for FIXED. */
  discountValue: number;
  sortOrder: number;
}

export interface BundleCandidate {
  bundleId: string;
  name: string;
  eligible: boolean;
  discount: Money;
  matchedCategoryIds: string[];
  missingCategoryIds: string[];
}

export interface BundleResult {
  applied: (BundleCandidate & { allocation: Record<string, Money> }) | null;
  /** Anchor present but not enough suggestion categories yet — the closest one (fewest missing). */
  nearMiss: BundleCandidate | null;
  candidates: BundleCandidate[];
}

export function evaluateBundles(rules: BundleRule[], lines: PromoLine[], currency: string, rounding: RoundingPolicy): BundleResult {
  const categoriesInCart = new Set(lines.map((l) => l.categoryId));
  const candidates: BundleCandidate[] = rules
    .filter((r) => categoriesInCart.has(r.anchorCategoryId))
    .map((rule) => {
      const matchedSuggestions = rule.suggestionCategoryIds.filter((c) => categoriesInCart.has(c));
      const matchedCategoryIds = [rule.anchorCategoryId, ...matchedSuggestions];
      const matchedAmount = sum(lines.filter((l) => matchedCategoryIds.includes(l.categoryId)).map((l) => l.amount), currency);
      const raw =
        rule.discountType === "PERCENTAGE"
          ? percentOf(matchedAmount, rule.discountValue, rounding.percentDiscount)
          : rule.discountType === "FIXED"
            ? fromMajor(rule.discountValue, currency)
            : zero(currency);
      return {
        bundleId: rule.id,
        name: rule.name,
        eligible: matchedSuggestions.length >= rule.minSuggestedCategories,
        // Capped at what the matched items actually cost (bundle discount cap).
        discount: clampNonNegative(min(raw, matchedAmount)),
        matchedCategoryIds,
        missingCategoryIds: rule.suggestionCategoryIds.filter((c) => !categoriesInCart.has(c)),
      };
    });

  const order = new Map(rules.map((r) => [r.id, r]));
  const byBest = (a: BundleCandidate, b: BundleCandidate) =>
    b.discount.amount - a.discount.amount || order.get(a.bundleId)!.sortOrder - order.get(b.bundleId)!.sortOrder || (a.bundleId < b.bundleId ? -1 : 1);
  const best = candidates.filter((c) => c.eligible && c.discount.amount > 0).sort(byBest)[0] ?? null;
  const nearMiss =
    candidates
      .filter((c) => !c.eligible)
      .sort((a, b) => a.missingCategoryIds.length - b.missingCategoryIds.length || (a.bundleId < b.bundleId ? -1 : 1))[0] ?? null;

  let applied: BundleResult["applied"] = null;
  if (best) {
    const matched = lines.filter((l) => best.matchedCategoryIds.includes(l.categoryId));
    const parts = allocateProportionally(best.discount, matched.map((l) => l.amount.amount));
    applied = { ...best, allocation: Object.fromEntries(matched.map((l, i) => [l.key, parts[i]!])) };
  }
  return { applied, nearMiss, candidates };
}

// --- coupons -----------------------------------------------------------------------------------

export interface CouponRule {
  id: string;
  code: string;
  type: "PERCENTAGE" | "FIXED" | "FREE_SHIPPING";
  /** Percent, or a major-unit amount for FIXED; null for FREE_SHIPPING. */
  value: number | null;
  scope: "ALL_PRODUCTS" | "SPECIFIC_PRODUCTS" | "SPECIFIC_CATEGORIES";
  productIds: string[];
  categoryIds: string[];
  minOrderAmount: Money | null;
  maxDiscountAmount: Money | null;
  minQuantity: number | null;
  usageLimit: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  startsAt: Date | string | null;
  expiresAt: Date | string | null;
  isActive: boolean;
  deleted: boolean;
}

export interface CouponContext {
  now: Date;
  /** This customer's redemptions of this coupon (D7 predicate); null when the customer isn't known yet. */
  customerRedemptions: number | null;
  /** This customer's prior orders; null when unknown. */
  customerPriorOrders: number | null;
}

export type CouponRejection =
  | "NOT_FOUND"
  | "NOT_STARTED"
  | "EXPIRED"
  | "USAGE_LIMIT"
  | "MIN_ORDER"
  | "NOT_APPLICABLE"
  | "MIN_QUANTITY"
  | "PER_CUSTOMER_LIMIT"
  | "FIRST_ORDER_ONLY";

export type CouponResult =
  | { ok: true; discount: Money; freeShipping: boolean; allocation: Record<string, Money>; eligibleProductIds: string[] }
  | { ok: false; reason: CouponRejection; message: string };

function formatAmount(m: Money): string {
  return formatMoney(toMajor(m), m.currency);
}

/**
 * Evaluates a coupon against the lines *after* the bundle discount (D9): its percentage applies to the eligible lines'
 * amounts minus the bundle discount allocated to those lines, and `minOrderAmount` is checked against the merchandise
 * total after the bundle discount. Messages are the ones customers have always seen.
 */
export function evaluateCoupon(
  rule: CouponRule | null,
  lines: PromoLine[],
  bundleAllocation: Record<string, Money>,
  ctx: CouponContext,
  currency: string,
  rounding: RoundingPolicy,
): CouponResult {
  const reject = (reason: CouponRejection, message: string): CouponResult => ({ ok: false, reason, message });
  if (!rule || !rule.isActive || rule.deleted) return reject("NOT_FOUND", "Coupon not found");
  const t = ctx.now.getTime();
  if (rule.startsAt && new Date(rule.startsAt).getTime() > t) return reject("NOT_STARTED", "This coupon isn't active yet");
  if (rule.expiresAt && new Date(rule.expiresAt).getTime() < t) return reject("EXPIRED", "Coupon has expired");
  if (rule.usageLimit !== null && rule.usedCount >= rule.usageLimit) return reject("USAGE_LIMIT", "Coupon usage limit reached");

  const after = (l: PromoLine) => clampNonNegative(subtract(l.amount, bundleAllocation[l.key] ?? zero(currency)));
  const merchandiseAfterBundle = sum(lines.map(after), currency);
  if (rule.minOrderAmount && merchandiseAfterBundle.amount < rule.minOrderAmount.amount) {
    return reject("MIN_ORDER", `Minimum order amount for this coupon is ${formatAmount(rule.minOrderAmount)}`);
  }

  const eligible =
    rule.scope === "ALL_PRODUCTS"
      ? lines
      : rule.scope === "SPECIFIC_PRODUCTS"
        ? lines.filter((l) => rule.productIds.includes(l.productId))
        : lines.filter((l) => rule.categoryIds.includes(l.categoryId));
  const eligibleAmount = sum(eligible.map(after), currency);
  if (rule.scope !== "ALL_PRODUCTS" && eligibleAmount.amount <= 0) {
    return reject("NOT_APPLICABLE", "This coupon doesn't apply to any items in your cart");
  }
  const eligibleQuantity = eligible.reduce((q, l) => q + l.quantity, 0);
  if (rule.minQuantity && eligibleQuantity < rule.minQuantity) {
    return reject("MIN_QUANTITY", `This coupon needs at least ${rule.minQuantity} eligible item(s) in your cart`);
  }
  if (rule.perCustomerLimit && ctx.customerRedemptions !== null && ctx.customerRedemptions >= rule.perCustomerLimit) {
    return reject("PER_CUSTOMER_LIMIT", "You've already used this coupon the maximum number of times");
  }
  if (rule.firstOrderOnly && ctx.customerPriorOrders !== null && ctx.customerPriorOrders > 0) {
    return reject("FIRST_ORDER_ONLY", "This coupon is only valid on your first order");
  }

  const eligibleProductIds = rule.scope === "ALL_PRODUCTS" ? [] : [...new Set(eligible.map((l) => l.productId))];
  if (rule.type === "FREE_SHIPPING") {
    return { ok: true, discount: zero(currency), freeShipping: true, allocation: {}, eligibleProductIds };
  }
  let discount = rule.type === "PERCENTAGE" ? percentOf(eligibleAmount, rule.value ?? 0, rounding.percentDiscount) : fromMajor(rule.value ?? 0, currency);
  if (rule.maxDiscountAmount) discount = min(discount, rule.maxDiscountAmount);
  discount = clampNonNegative(min(discount, eligibleAmount));
  const parts = allocateProportionally(discount, eligible.map((l) => after(l).amount));
  return {
    ok: true,
    discount,
    freeShipping: false,
    allocation: Object.fromEntries(eligible.map((l, i) => [l.key, parts[i]!])),
    eligibleProductIds,
  };
}

/** Coupon value used to rank candidate coupons (best-coupon suggestion): discount, with free shipping worth its fee. */
export function couponValue(result: CouponResult, shippingFee: Money | null): number {
  if (!result.ok) return -1;
  return result.freeShipping ? (shippingFee?.amount ?? 0) : result.discount.amount;
}

