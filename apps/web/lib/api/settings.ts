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

export function uploadPaymentMethodsImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch<{ url: string }>("/api/settings/upload-payment-methods-image", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
}

/** Phase 12 (D-4): booleans-only integration status (GET /api/v1/ops/providers, settings.manage). */
export interface ProviderStatusEntry {
  capability: "payments" | "sms" | "email" | "push" | "courier" | "serverEvents";
  provider: string;
  enabled: boolean;
  credentialsPresent: boolean;
}

export function getProviderStatus() {
  return apiFetch<{ providers: ProviderStatusEntry[] }>("/api/v1/ops/providers");
}
