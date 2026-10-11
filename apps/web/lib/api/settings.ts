import type { CreateShippingZoneInput, IntegrationsView, ShippingZoneRow, StoreSettings, UpdateSettingsInput, UpdateShippingZoneInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function getSettings() {
  return apiFetch<{ settings: StoreSettings }>("/api/settings");
}

export function updateSettings(input: UpdateSettingsInput) {
  return apiFetch<{ settings: StoreSettings }>("/api/settings", { method: "PATCH", body: input });
}

/** Delivery zones (DR-17): what checkout charges per area. */
export function listShippingZones() {
  return apiFetch<{ items: ShippingZoneRow[] }>("/api/settings/shipping-zones");
}

export function createShippingZone(input: CreateShippingZoneInput) {
  return apiFetch<ShippingZoneRow>("/api/settings/shipping-zones", { method: "POST", body: input });
}

export function updateShippingZone(id: string, input: UpdateShippingZoneInput) {
  return apiFetch<ShippingZoneRow>(`/api/settings/shipping-zones/${id}`, { method: "PATCH", body: input });
}

export function deleteShippingZone(id: string) {
  return apiFetch<void>(`/api/settings/shipping-zones/${id}`, { method: "DELETE" });
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

/** The default social-sharing image (1200×630, see the API's processSocialImage). */
export function uploadSocialImage(file: File) {
  const form = new FormData();
  form.append("image", file);
  return apiFetch<{ url: string }>("/api/settings/upload-social-image", {
    method: "POST",
    body: form,
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

/** Settings › Integrations — third-party credentials (OWNER). Secrets come back only as a source + last-4 hint. */
export function getIntegrations() {
  return apiFetch<IntegrationsView>("/api/settings/integrations");
}

/** `null` removes the dashboard value (the server's environment value, if any, applies again). */
export function updateIntegrations(values: Record<string, string | null>) {
  return apiFetch<IntegrationsView>("/api/settings/integrations", { method: "PATCH", body: { values } });
}

export function generateWebPushKeys() {
  return apiFetch<IntegrationsView>("/api/settings/integrations/webpush/generate-keys", { method: "POST" });
}
