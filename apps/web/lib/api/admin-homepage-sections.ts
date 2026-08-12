import type { CreateHomepageSectionInput, HomepageSection, UpdateHomepageSectionInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listHomepageSections() {
  return apiFetch<{ sections: HomepageSection[] }>("/api/homepage-sections");
}

export function createHomepageSection(input: CreateHomepageSectionInput) {
  return apiFetch<{ section: HomepageSection }>("/api/homepage-sections", { method: "POST", body: input });
}

export function uploadHomepageSectionImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch<{ url: string }>("/api/homepage-sections/upload-image", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
}

export function updateHomepageSection(id: string, input: UpdateHomepageSectionInput) {
  return apiFetch<{ section: HomepageSection }>(`/api/homepage-sections/${id}`, { method: "PATCH", body: input });
}

export function reorderHomepageSections(ids: string[]) {
  return apiFetch<{ sections: HomepageSection[] }>("/api/homepage-sections/reorder", {
    method: "PATCH",
    body: { ids },
  });
}

export function deleteHomepageSection(id: string) {
  return apiFetch<void>(`/api/homepage-sections/${id}`, { method: "DELETE" });
}
