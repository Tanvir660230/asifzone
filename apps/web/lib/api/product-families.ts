import type { ProductFamilyDetail, ProductFamilySummary, SaveProductFamilyInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

// Product families (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §3) — admin side. The storefront reads them through
// lib/api/storefront.ts (getProductFamilies).

export function listProductFamilies() {
  return apiFetch<{ families: ProductFamilySummary[] }>("/api/product-families");
}

export function getProductFamily(id: string) {
  return apiFetch<{ family: ProductFamilyDetail }>(`/api/product-families/${id}`);
}

export function createProductFamily(input: SaveProductFamilyInput) {
  return apiFetch<{ family: ProductFamilyDetail }>("/api/product-families", { method: "POST", body: input });
}

export function saveProductFamily(id: string, input: SaveProductFamilyInput) {
  return apiFetch<{ family: ProductFamilyDetail }>(`/api/product-families/${id}`, { method: "PUT", body: input });
}

export function deleteProductFamily(id: string) {
  return apiFetch<void>(`/api/product-families/${id}`, { method: "DELETE" });
}
