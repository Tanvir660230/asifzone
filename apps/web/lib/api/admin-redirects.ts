import type { CreateRedirectInput, PaginatedResult, Redirect, UpdateRedirectInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listRedirects(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  return apiFetch<PaginatedResult<Redirect>>(`/api/redirects?${query.toString()}`);
}

export function createRedirect(input: CreateRedirectInput) {
  return apiFetch<{ redirect: Redirect }>("/api/redirects", { method: "POST", body: input });
}

export function updateRedirect(id: string, input: UpdateRedirectInput) {
  return apiFetch<{ redirect: Redirect }>(`/api/redirects/${id}`, { method: "PATCH", body: input });
}

export function deleteRedirect(id: string) {
  return apiFetch<void>(`/api/redirects/${id}`, { method: "DELETE" });
}
