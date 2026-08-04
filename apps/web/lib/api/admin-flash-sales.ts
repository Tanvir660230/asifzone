import type { AddFlashSaleItemInput, CreateFlashSaleInput, FlashSale, UpdateFlashSaleInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listFlashSales() {
  return apiFetch<{ flashSales: FlashSale[] }>("/api/flash-sales");
}

export function getFlashSale(id: string) {
  return apiFetch<{ flashSale: FlashSale }>(`/api/flash-sales/${id}`);
}

export function createFlashSale(input: CreateFlashSaleInput) {
  return apiFetch<{ flashSale: FlashSale }>("/api/flash-sales", { method: "POST", body: input });
}

export function updateFlashSale(id: string, input: UpdateFlashSaleInput) {
  return apiFetch<{ flashSale: FlashSale }>(`/api/flash-sales/${id}`, { method: "PATCH", body: input });
}

export function deleteFlashSale(id: string) {
  return apiFetch<void>(`/api/flash-sales/${id}`, { method: "DELETE" });
}

export function addFlashSaleItem(flashSaleId: string, input: AddFlashSaleItemInput) {
  return apiFetch<{ flashSale: FlashSale }>(`/api/flash-sales/${flashSaleId}/items`, { method: "POST", body: input });
}

export function removeFlashSaleItem(flashSaleId: string, itemId: string) {
  return apiFetch<{ flashSale: FlashSale }>(`/api/flash-sales/${flashSaleId}/items/${itemId}`, { method: "DELETE" });
}
