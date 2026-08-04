import type { Coupon, CreateCouponInput, PaginatedResult, UpdateCouponInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listCoupons(params: { page?: number; pageSize?: number; search?: string } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  return apiFetch<PaginatedResult<Coupon>>(`/api/coupons?${query.toString()}`);
}

export function createCoupon(input: CreateCouponInput) {
  return apiFetch<{ coupon: Coupon }>("/api/coupons", { method: "POST", body: input });
}

export function updateCoupon(id: string, input: UpdateCouponInput) {
  return apiFetch<{ coupon: Coupon }>(`/api/coupons/${id}`, { method: "PATCH", body: input });
}

export function deleteCoupon(id: string) {
  return apiFetch<void>(`/api/coupons/${id}`, { method: "DELETE" });
}
