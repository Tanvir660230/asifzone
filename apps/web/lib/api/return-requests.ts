import type { CreateReturnRequestInput, PaginatedResult, ReturnRequest, ReturnRequestStatus } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function createReturnRequest(input: CreateReturnRequestInput) {
  return apiFetch<{ request: ReturnRequest }>("/api/return-requests", { method: "POST", body: input });
}

export function listMyReturnRequests(params: { page?: number; pageSize?: number; status?: ReturnRequestStatus } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.status) query.set("status", params.status);
  return apiFetch<PaginatedResult<ReturnRequest>>(`/api/return-requests/mine?${query.toString()}`);
}
