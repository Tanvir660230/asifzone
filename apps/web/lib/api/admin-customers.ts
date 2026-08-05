import type { AdminCustomerListItem, AdminCustomerDetail, PaginatedResult } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface AdminCustomerListParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export function listCustomers(params: AdminCustomerListParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);

  return apiFetch<PaginatedResult<AdminCustomerListItem>>(`/api/customers/admin?${query.toString()}`);
}

export function getCustomer(id: string) {
  return apiFetch<{ customer: AdminCustomerDetail }>(`/api/customers/admin/${id}`);
}

export function adjustPoints(id: string, points: number, reason?: string) {
  return apiFetch<{ customer: AdminCustomerDetail }>(`/api/customers/admin/${id}/points`, {
    method: "POST",
    body: { points, reason },
  });
}
