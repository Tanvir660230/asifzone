import type { PaginatedResult, ReturnRequest, ReturnRequestStatus, ReviewReturnRequestInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listReturnRequests(params: { page?: number; pageSize?: number; status?: ReturnRequestStatus } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.status) query.set("status", params.status);
  return apiFetch<PaginatedResult<ReturnRequest>>(`/api/return-requests?${query.toString()}`);
}

export function reviewReturnRequest(id: string, input: ReviewReturnRequestInput) {
  return apiFetch<{ request: ReturnRequest }>(`/api/return-requests/${id}`, { method: "PATCH", body: input });
}
