import type { Category, CreateCategoryInput, UpdateCategoryInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listCategories() {
  return apiFetch<{ categories: Category[] }>("/api/categories");
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

export function updateCategory(id: string, input: UpdateCategoryInput) {
  return apiFetch<{ category: Category }>(`/api/categories/${id}`, { method: "PATCH", body: input });
}

export function deleteCategory(id: string) {
  return apiFetch<void>(`/api/categories/${id}`, { method: "DELETE" });
}
