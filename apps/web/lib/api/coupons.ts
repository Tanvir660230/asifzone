import type { Coupon } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface CouponPreview {
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  discount: number;
}

export function validateCoupon(code: string, subtotal: number) {
  return apiFetch<CouponPreview>("/api/coupons/validate", { method: "POST", body: { code, subtotal } });
}

/** Best coupon the shopper already qualifies for at this subtotal, with no code required — null if none apply. */
export function getBestCoupon(subtotal: number) {
  return apiFetch<{ result: CouponPreview | null }>(`/api/coupons/best?subtotal=${subtotal}`);
}

/** Every currently-usable coupon — powers the account "Coupons" page. */
export function listActiveCoupons() {
  return apiFetch<{ coupons: Coupon[] }>("/api/coupons/active");
}
