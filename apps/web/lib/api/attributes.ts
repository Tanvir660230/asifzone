import type { Attribute, CreateAttributeInput, UpdateAttributeInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listAttributes() {
  return apiFetch<{ attributes: Attribute[] }>("/api/attributes");
}

export function createAttribute(input: CreateAttributeInput) {
  return apiFetch<{ attribute: Attribute }>("/api/attributes", { method: "POST", body: input });
}

export function updateAttribute(id: string, input: UpdateAttributeInput) {
  return apiFetch<{ attribute: Attribute }>(`/api/attributes/${id}`, { method: "PATCH", body: input });
}

export function deleteAttribute(id: string) {
  return apiFetch<void>(`/api/attributes/${id}`, { method: "DELETE" });
}
