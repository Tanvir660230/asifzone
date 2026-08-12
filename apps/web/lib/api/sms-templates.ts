import type { SmsTemplate, CreateSmsTemplateInput, UpdateSmsTemplateInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listSmsTemplates() {
  return apiFetch<{ templates: SmsTemplate[] }>("/api/sms-templates");
}

export function createSmsTemplate(input: CreateSmsTemplateInput) {
  return apiFetch<{ template: SmsTemplate }>("/api/sms-templates", { method: "POST", body: input });
}

export function updateSmsTemplate(id: string, input: UpdateSmsTemplateInput) {
  return apiFetch<{ template: SmsTemplate }>(`/api/sms-templates/${id}`, { method: "PATCH", body: input });
}

export function deleteSmsTemplate(id: string) {
  return apiFetch<void>(`/api/sms-templates/${id}`, { method: "DELETE" });
}
