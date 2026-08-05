import type {
  Address,
  CreateAddressInput,
  UpdateAddressInput,
  Order,
  PaginatedResult,
  RewardPointsEntry,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listAddresses() {
  return apiFetch<{ addresses: Address[] }>("/api/customers/me/addresses");
}

export function createAddress(input: CreateAddressInput) {
  return apiFetch<{ address: Address }>("/api/customers/me/addresses", { method: "POST", body: input });
}

export function updateAddress(id: string, input: UpdateAddressInput) {
  return apiFetch<{ address: Address }>(`/api/customers/me/addresses/${id}`, { method: "PATCH", body: input });
}

export function deleteAddress(id: string) {
  return apiFetch<void>(`/api/customers/me/addresses/${id}`, { method: "DELETE" });
}

export function listMyOrders(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  return apiFetch<PaginatedResult<Order>>(`/api/customers/me/orders?${query.toString()}`);
}

export function getMyOrder(id: string) {
  return apiFetch<{ order: Order }>(`/api/customers/me/orders/${id}`);
}

export function listMyPointsLedger(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  return apiFetch<PaginatedResult<RewardPointsEntry>>(`/api/customers/me/points?${query.toString()}`);
}
