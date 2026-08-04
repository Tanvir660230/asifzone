import type {
  Product,
  CreateProductInput,
  UpdateProductInput,
  PaginatedResult,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface ProductListParams {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  search?: string;
}

export function listProducts(params: ProductListParams = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.search) query.set("search", params.search);

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
