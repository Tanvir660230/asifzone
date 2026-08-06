import type { StoreSettings, UpdateSettingsInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function getSettings() {
  return apiFetch<{ settings: StoreSettings }>("/api/settings");
}

export function updateSettings(input: UpdateSettingsInput) {
  return apiFetch<{ settings: StoreSettings }>("/api/settings", { method: "PATCH", body: input });
}

export function uploadLogo(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch<{ url: string }>("/api/settings/upload-logo", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
}

export function uploadFavicon(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch<{ url: string }>("/api/settings/upload-favicon", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
}
