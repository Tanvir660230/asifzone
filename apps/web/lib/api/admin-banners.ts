import type { Banner, CreateBannerInput, UpdateBannerInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listBanners() {
  return apiFetch<{ banners: Banner[] }>("/api/banners");
}

export function createBanner(input: CreateBannerInput) {
  return apiFetch<{ banner: Banner }>("/api/banners", { method: "POST", body: input });
}

export function uploadBannerImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch<{ url: string }>("/api/banners/upload-image", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
}

export function updateBanner(id: string, input: UpdateBannerInput) {
  return apiFetch<{ banner: Banner }>(`/api/banners/${id}`, { method: "PATCH", body: input });
}

export function deleteBanner(id: string) {
  return apiFetch<void>(`/api/banners/${id}`, { method: "DELETE" });
}
