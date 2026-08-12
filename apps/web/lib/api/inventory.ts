import type { AdjustStockInput, PaginatedResult, ProductVariant, StockDiscrepancy, StockMovement } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface StockMovementListParams {
  page?: number;
  pageSize?: number;
  variantId?: string;
  productId?: string;
  reason?: "ORDER" | "RESTOCK" | "ADJUSTMENT" | "RETURN";
  from?: string;
  to?: string;
}

export function listStockMovements(params: StockMovementListParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.variantId) query.set("variantId", params.variantId);
  if (params.productId) query.set("productId", params.productId);
  if (params.reason) query.set("reason", params.reason);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  return apiFetch<PaginatedResult<StockMovement>>(`/api/inventory/movements?${query.toString()}`);
}

export function adjustStock(variantId: string, input: AdjustStockInput) {
  return apiFetch<{ variant: ProductVariant }>(`/api/inventory/variants/${variantId}/adjust`, {
    method: "POST",
    body: input,
  });
}

export function getStockReconciliation() {
  return apiFetch<{ discrepancies: StockDiscrepancy[] }>("/api/inventory/reconciliation");
}
