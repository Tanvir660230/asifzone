import type { Order, OrderStatus, PaginatedResult, UpdateOrderDetailsInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface AdminOrderListParams {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  search?: string;
  deleted?: boolean;
}

export function listOrders(params: AdminOrderListParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  if (params.deleted) query.set("deleted", "true");

  return apiFetch<PaginatedResult<Order>>(`/api/orders?${query.toString()}`);
}

export function getOrder(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}`);
}

export function updateOrderStatus(id: string, status: OrderStatus, note?: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/status`, { method: "PATCH", body: { status, note } });
}

export function updateOrderDetails(id: string, input: UpdateOrderDetailsInput) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/details`, { method: "PATCH", body: input });
}

export function deleteOrder(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}`, { method: "DELETE" });
}

export function restoreOrder(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/restore`, { method: "POST" });
}

export function bookCourier(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/courier/book`, { method: "POST" });
}

export function refreshCourierStatus(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/courier/refresh`, { method: "POST" });
}
