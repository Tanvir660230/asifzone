import type { PaginatedResult, ProductReview, ReviewStatus } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listReviewsAdmin(params: { page?: number; pageSize?: number; status?: ReviewStatus } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.status) query.set("status", params.status);
  return apiFetch<PaginatedResult<ProductReview>>(`/api/reviews/admin?${query.toString()}`);
}

export function moderateReview(id: string, status: "APPROVED" | "REJECTED") {
  return apiFetch<{ review: ProductReview }>(`/api/reviews/admin/${id}`, { method: "PATCH", body: { status } });
}

export function deleteReview(id: string) {
  return apiFetch<void>(`/api/reviews/admin/${id}`, { method: "DELETE" });
}
