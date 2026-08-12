import type {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
  ReorderCategoriesInput,
  MoveCategoryInput,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listCategories(params: { trashed?: boolean } = {}) {
  const query = new URLSearchParams();
  if (params.trashed) query.set("trashed", "true");
  const qs = query.toString();
  return apiFetch<{ categories: Category[] }>(`/api/categories${qs ? `?${qs}` : ""}`);
}

export function createCategory(input: CreateCategoryInput) {
  return apiFetch<{ category: Category }>("/api/categories", { method: "POST", body: input });
}

export function uploadCategoryImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch<{ url: string }>("/api/categories/upload-image", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
}

export function uploadCategoryBannerImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch<{ url: string }>("/api/categories/upload-banner", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
}

export function updateCategory(id: string, input: UpdateCategoryInput) {
  return apiFetch<{ category: Category }>(`/api/categories/${id}`, { method: "PATCH", body: input });
}

export function deleteCategory(id: string) {
  return apiFetch<void>(`/api/categories/${id}`, { method: "DELETE" });
}

export function restoreCategory(id: string) {
  return apiFetch<{ category: Category }>(`/api/categories/${id}/restore`, { method: "POST" });
}

export function permanentlyDeleteCategory(id: string) {
  return apiFetch<void>(`/api/categories/${id}/permanent`, { method: "DELETE" });
}

export function reorderCategories(input: ReorderCategoriesInput) {
  return apiFetch<void>("/api/categories/reorder", { method: "POST", body: input });
}

export function moveCategory(id: string, input: MoveCategoryInput) {
  return apiFetch<{ category: Category }>(`/api/categories/${id}/move`, { method: "POST", body: input });
}
