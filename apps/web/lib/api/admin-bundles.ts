import type { Bundle, CreateBundleInput, PaginatedResult, UpdateBundleInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listBundles(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  return apiFetch<PaginatedResult<Bundle>>(`/api/bundles?${query.toString()}`);
}

export function createBundle(input: CreateBundleInput) {
  return apiFetch<{ bundle: Bundle }>("/api/bundles", { method: "POST", body: input });
}

export function updateBundle(id: string, input: UpdateBundleInput) {
  return apiFetch<{ bundle: Bundle }>(`/api/bundles/${id}`, { method: "PATCH", body: input });
}

export function deleteBundle(id: string) {
  return apiFetch<void>(`/api/bundles/${id}`, { method: "DELETE" });
}
