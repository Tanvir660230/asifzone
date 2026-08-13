import type { Coupon } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface CouponCartItem {
  variantId: string;
  quantity: number;
}

export interface CouponPreview {
  code: string;
  type: "PERCENTAGE" | "FIXED" | "FREE_SHIPPING";
  value: string | null;
  discount: number;
  freeShipping: boolean;
  /** Product ids the discount actually matched — empty when the coupon applies to the whole cart. */
  eligibleProductIds: string[];
}

export function validateCoupon(code: string, subtotal: number, items?: CouponCartItem[]) {
  return apiFetch<CouponPreview>("/api/coupons/validate", { method: "POST", body: { code, subtotal, items } });
}

/** Best coupon the shopper already qualifies for at this subtotal, with no code required — null if none apply. */
export function getBestCoupon(subtotal: number, items?: CouponCartItem[]) {
  return apiFetch<{ result: CouponPreview | null }>("/api/coupons/best", { method: "POST", body: { subtotal, items } });
}

/** Every currently-usable coupon — powers the account "Coupons" page. */
export function listActiveCoupons() {
  return apiFetch<{ coupons: Coupon[] }>("/api/coupons/active");
}
