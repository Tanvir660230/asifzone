import type {
  Product,
  CreateProductInput,
  UpdateProductInput,
  PaginatedResult,
  ProductStatus,
  DuplicateProductInput,
  DuplicateProductResult,
  ProductImportReport,
  ProductImportResult,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";
import { env } from "../env";

export interface ProductListParams {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  search?: string;
  trashed?: boolean;
  status?: ProductStatus;
  typeId?: string;
}

export function listProducts(params: ProductListParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.search) query.set("search", params.search);
  if (params.trashed) query.set("trashed", "true");
  if (params.status) query.set("status", params.status);
  if (params.typeId) query.set("typeId", params.typeId);

  return apiFetch<PaginatedResult<Product>>(`/api/products?${query.toString()}`);
}

export function getProduct(id: string) {
  return apiFetch<{ product: Product }>(`/api/products/${id}`);
}

export function createProduct(input: CreateProductInput) {
  return apiFetch<{ product: Product }>("/api/products", { method: "POST", body: input });
}

export function updateProduct(id: string, input: UpdateProductInput) {
  return apiFetch<{ product: Product }>(`/api/products/${id}`, { method: "PATCH", body: input });
}

export function deleteProduct(id: string) {
  return apiFetch<void>(`/api/products/${id}`, { method: "DELETE" });
}

export function restoreProduct(id: string) {
  return apiFetch<{ product: Product }>(`/api/products/${id}/restore`, { method: "POST" });
}

export function permanentlyDeleteProduct(id: string) {
  return apiFetch<void>(`/api/products/${id}/permanent`, { method: "DELETE" });
}

export function bulkDeleteProducts(ids: string[]) {
  return apiFetch<void>("/api/products/bulk/delete", { method: "POST", body: { ids } });
}

export interface BulkStatusResult {
  updated: number;
  unchanged: number;
  /** Products that couldn't go live/ready, with the required checks they're missing. */
  blocked: { id: string; name: string; missing: string[] }[];
}

export function bulkUpdateProductStatus(ids: string[], status: ProductStatus) {
  return apiFetch<BulkStatusResult>("/api/products/bulk/status", { method: "POST", body: { ids, status } });
}

export interface ProductHistoryItem {
  id: string;
  action: string;
  createdAt: string;
  admin: { name: string } | null;
  metadata: { changes?: { field: string; from: unknown; to: unknown }[]; bulk?: boolean } | null;
}

export function getProductHistory(id: string, page = 1) {
  return apiFetch<{ items: ProductHistoryItem[]; total: number; page: number; pageSize: number }>(`/api/products/${id}/history?page=${page}`);
}

export function bulkUpdateProductCategory(ids: string[], categoryId: string) {
  return apiFetch<void>("/api/products/bulk/category", { method: "POST", body: { ids, categoryId } });
}

/** CSV export needs the browser's cookie jar for admin auth but isn't JSON, so it bypasses apiFetch —
 * a plain same-tab navigation lets the browser handle the file download via Content-Disposition. */
export function downloadProductsCsvUrl() {
  return `${env.apiUrl}/api/products/export/csv`;
}

/** The importable format (one row per variant) — a plain navigation, like the summary export above. */
export function exportFullCsvUrl(typeId?: string) {
  return `${env.apiUrl}/api/products/export/full${typeId ? `?typeId=${encodeURIComponent(typeId)}` : ""}`;
}

export function importTemplateUrl(typeId?: string) {
  return `${env.apiUrl}/api/products/import/template${typeId ? `?typeId=${encodeURIComponent(typeId)}` : ""}`;
}

/** A draft copy of a product; the input says what to bring along. */
export function duplicateProduct(id: string, input: DuplicateProductInput) {
  return apiFetch<DuplicateProductResult>(`/api/products/${id}/duplicate`, { method: "POST", body: input });
}

/** Checks a CSV without writing anything. */
export function validateProductImport(csv: string) {
  return apiFetch<{ report: ProductImportReport }>("/api/products/import/validate", { method: "POST", body: { csv } });
}

/** Writes it. With errors and no `skipInvalid` the API answers 422 and the ApiError's `details.report` says why. */
export function commitProductImport(csv: string, skipInvalid: boolean) {
  return apiFetch<{ report: ProductImportReport; result: ProductImportResult }>("/api/products/import/commit", {
    method: "POST",
    body: { csv, skipInvalid },
  });
}

export function uploadProductImages(id: string, files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("images", file));
  return apiFetch<{ product: Product }>(`/api/products/${id}/images`, {
    method: "POST",
    body: formData,
    isFormData: true,
  });
}

export function deleteProductImage(productId: string, imageId: string) {
  return apiFetch<void>(`/api/products/${productId}/images/${imageId}`, { method: "DELETE" });
}

export function updateProductImage(productId: string, imageId: string, input: { altText?: string; caption?: string | null }) {
  return apiFetch<void>(`/api/products/${productId}/images/${imageId}`, { method: "PATCH", body: input });
}

export function updateProductImageAltText(productId: string, imageId: string, altText: string) {
  return apiFetch<void>(`/api/products/${productId}/images/${imageId}`, { method: "PATCH", body: { altText } });
}

export function reorderProductImages(productId: string, imageIds: string[]) {
  return apiFetch<{ product: Product }>(`/api/products/${productId}/images/reorder`, {
    method: "PATCH",
    body: { imageIds },
  });
}
