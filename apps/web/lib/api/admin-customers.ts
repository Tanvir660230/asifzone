import type {
  AdminCustomerListItem,
  AdminCustomerDetail,
  Customer,
  CustomerStats,
  CustomerTag,
  PaginatedResult,
  UpdateCustomerAdminFieldsInput,
  CreateCustomerAdminInput,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface AdminCustomerListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  tag?: CustomerTag;
  district?: string;
  noOrders?: "true" | "false";
  lastOrderDays?: number;
  minSpend?: number;
  minOrders?: number;
  sortBy?: "name" | "createdAt" | "totalSpent" | "totalOrders" | "lastOrderAt";
  sortDir?: "asc" | "desc";
}

function buildCustomerListQuery(params: AdminCustomerListParams) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  if (params.tag) query.set("tag", params.tag);
  if (params.district) query.set("district", params.district);
  if (params.noOrders) query.set("noOrders", params.noOrders);
  if (params.lastOrderDays) query.set("lastOrderDays", String(params.lastOrderDays));
  if (params.minSpend) query.set("minSpend", String(params.minSpend));
  if (params.minOrders) query.set("minOrders", String(params.minOrders));
  if (params.sortBy) query.set("sortBy", params.sortBy);
  if (params.sortDir) query.set("sortDir", params.sortDir);
  return query;
}

export function listCustomers(params: AdminCustomerListParams = {}) {
  return apiFetch<PaginatedResult<AdminCustomerListItem>>(`/api/customers/admin?${buildCustomerListQuery(params).toString()}`);
}

export function getCustomerStats() {
  return apiFetch<CustomerStats>("/api/customers/admin/stats");
}

export function createCustomer(input: CreateCustomerAdminInput) {
  return apiFetch<{ customer: Customer & { adminNotes: string | null; isBlocked: boolean; codRisk: boolean } }>(
    "/api/customers/admin",
    { method: "POST", body: input },
  );
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

export function updateCustomerAdminFields(id: string, input: UpdateCustomerAdminFieldsInput) {
  return apiFetch<{ customer: AdminCustomerDetail }>(`/api/customers/admin/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export function sendAdHocSms(id: string, body: string) {
  return apiFetch<{ ok: true; sentAt: string }>(`/api/customers/admin/${id}/sms`, {
    method: "POST",
    body: { body },
  });
}

export interface BulkSmsResult {
  sent: number;
  failed: number;
  skipped: number;
}

export function sendBulkSms(customerIds: string[], body: string) {
  return apiFetch<BulkSmsResult>("/api/customers/admin/bulk/sms", {
    method: "POST",
    body: { customerIds, body },
  });
}
