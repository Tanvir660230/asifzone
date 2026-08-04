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
