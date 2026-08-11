import type { SmsNotificationSettings, UpdateSmsSettingsInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function getSmsSettings() {
  return apiFetch<{ settings: SmsNotificationSettings }>("/api/sms-settings");
}

export function updateSmsSettings(input: UpdateSmsSettingsInput) {
  return apiFetch<{ settings: SmsNotificationSettings }>("/api/sms-settings", { method: "PATCH", body: input });
}
