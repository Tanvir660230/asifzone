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
  /** Selected AND credentials present — whether the admin offers this capability's actions. */
  available: boolean;
  /** Names of credential variables still unset (never values). */
  missingCredentials: string[];
}

export function getProviderStatus() {
  return apiFetch<{ providers: ProviderStatusEntry[] }>("/api/v1/ops/providers");
}

/** Phase 12 D-4: booleans only — which provider-backed actions work on this deployment (GET /api/v1/ops/capabilities). */
export interface ProviderCapabilities {
  sms: boolean;
  email: boolean;
  push: boolean;
  courier: boolean;
  payments: { SSLCOMMERZ: boolean; EPS_PG: boolean };
}

export function getProviderCapabilities() {
  return apiFetch<{ capabilities: ProviderCapabilities }>("/api/v1/ops/capabilities");
}
