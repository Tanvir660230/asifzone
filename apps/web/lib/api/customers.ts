import type {
  AccountSummary,
  Address,
  CreateAddressInput,
  UpdateAddressInput,
  Order,
  OrderModificationInput,
  OrderModificationPreview,
  OrderModificationRecord,
  StoreCreditSummary,
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

// ─── Store balance and self-service order changes (docs/ORDER_ADJUSTMENTS.md §18) ────────────────────────────────────

export function getMyStoreCredit() {
  return apiFetch<{ storeCredit: StoreCreditSummary }>("/api/customers/me/store-credit");
}

export function cancelMyOrder(id: string, reason?: string) {
  return apiFetch<{ orderId: string; status: "CANCELLED"; storeCredit: number; currency: string; message: string | null }>(
    `/api/customers/me/orders/${id}/cancel`,
    { method: "POST", body: { reason: reason || null } },
  );
}

export function previewMyOrderChange(id: string, input: OrderModificationInput) {
  return apiFetch<{ preview: OrderModificationPreview }>(`/api/customers/me/orders/${id}/modifications/preview`, { method: "POST", body: input });
}

export function applyMyOrderChange(id: string, input: OrderModificationInput, idempotencyKey: string) {
  return apiFetch<{ modification: { id: string; status: string; amountDue: number; amountCredited: number }; preview: OrderModificationPreview }>(
    `/api/customers/me/orders/${id}/modifications`,
    { method: "POST", body: input, idempotencyKey },
  );
}

export function listMyOrderChanges(id: string) {
  return apiFetch<{ modifications: OrderModificationRecord[] }>(`/api/customers/me/orders/${id}/modifications`);
}

/** Pays a change that is waiting for its price difference (the server decides the amount). Returns the gateway URL. */
export function payMyOrderChange(id: string, modificationId: string, provider: "SSLCOMMERZ" | "EPS_PG") {
  return apiFetch<{ gatewayUrl: string }>(`/api/customers/me/orders/${id}/modifications/${modificationId}/pay`, { method: "POST", body: { provider } });
}

// ─── Account home (docs/ACCOUNT_HOME.md) ─────────────────────────────────────────────────────────────────────────────

export const ACCOUNT_SUMMARY_KEY = ["account-summary"] as const;

export function getMyAccountSummary() {
  return apiFetch<{ summary: AccountSummary }>("/api/customers/me/summary");
}
