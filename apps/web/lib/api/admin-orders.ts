import type { Order, OrderStatus, PaginatedResult } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface AdminOrderListParams {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  search?: string;
}

export function listOrders(params: AdminOrderListParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);

  return apiFetch<PaginatedResult<Order>>(`/api/orders?${query.toString()}`);
}

export function getOrder(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}`);
}

export function updateOrderStatus(id: string, status: OrderStatus) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/status`, { method: "PATCH", body: { status } });
}
