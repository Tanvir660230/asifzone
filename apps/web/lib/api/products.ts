import type {
  Product,
  CreateProductInput,
  UpdateProductInput,
  PaginatedResult,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";
import { env } from "../env";

export interface ProductListParams {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  search?: string;
  trashed?: boolean;
}

export function listProducts(params: ProductListParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.search) query.set("search", params.search);
  if (params.trashed) query.set("trashed", "true");

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

export function bulkUpdateProductStatus(ids: string[], isActive: boolean) {
  return apiFetch<void>("/api/products/bulk/status", { method: "POST", body: { ids, isActive } });
}

export function bulkUpdateProductCategory(ids: string[], categoryId: string) {
  return apiFetch<void>("/api/products/bulk/category", { method: "POST", body: { ids, categoryId } });
}

/** CSV export needs the browser's cookie jar for admin auth but isn't JSON, so it bypasses apiFetch —
 * a plain same-tab navigation lets the browser handle the file download via Content-Disposition. */
export function downloadProductsCsvUrl() {
  return `${env.apiUrl}/api/products/export/csv`;
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
