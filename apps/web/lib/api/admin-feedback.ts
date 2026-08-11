import type { Feedback, FeedbackStatusFilter, PaginatedResult } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface AdminFeedbackListParams {
  page?: number;
  pageSize?: number;
  status?: FeedbackStatusFilter;
  search?: string;
}

export function listFeedback(params: AdminFeedbackListParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);

  return apiFetch<PaginatedResult<Feedback>>(`/api/feedback?${query.toString()}`);
}

export function markFeedbackRead(id: string) {
  return apiFetch<{ feedback: Feedback }>(`/api/feedback/${id}/read`, { method: "PATCH" });
}

export function deleteFeedback(id: string) {
  return apiFetch<void>(`/api/feedback/${id}`, { method: "DELETE" });
}
