import type { CreateLandingPageInput, DuplicateLandingPageInput, LandingPageDetail, LandingPageSummary, SaveLandingPageInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

// Campaign landing pages (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §2).

export function listLandingPages() {
  return apiFetch<{ pages: LandingPageSummary[] }>("/api/landing-pages");
}

export function getLandingPage(id: string) {
  return apiFetch<{ page: LandingPageDetail }>(`/api/landing-pages/${id}`);
}

export function createLandingPage(input: CreateLandingPageInput) {
  return apiFetch<{ page: LandingPageDetail }>("/api/landing-pages", { method: "POST", body: input });
}

export function saveLandingPage(id: string, input: SaveLandingPageInput) {
  return apiFetch<{ page: LandingPageDetail }>(`/api/landing-pages/${id}`, { method: "PUT", body: input });
}

export function publishLandingPage(id: string) {
  return apiFetch<{ page: LandingPageDetail }>(`/api/landing-pages/${id}/publish`, { method: "POST" });
}

export function unpublishLandingPage(id: string) {
  return apiFetch<{ page: LandingPageDetail }>(`/api/landing-pages/${id}/unpublish`, { method: "POST" });
}

export function duplicateLandingPage(id: string, input: DuplicateLandingPageInput) {
  return apiFetch<{ page: LandingPageDetail }>(`/api/landing-pages/${id}/duplicate`, { method: "POST", body: input });
}

export function deleteLandingPage(id: string) {
  return apiFetch<void>(`/api/landing-pages/${id}`, { method: "DELETE" });
}

export function uploadLandingImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch<{ url: string }>("/api/landing-pages/upload-image", { method: "POST", body: formData, isFormData: true });
}
