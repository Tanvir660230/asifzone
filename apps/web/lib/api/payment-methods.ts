import type {
  PaymentMethodOption,
  CreatePaymentMethodInput,
  UpdatePaymentMethodInput,
  ReorderPaymentMethodsInput,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listPaymentMethods() {
  return apiFetch<{ methods: PaymentMethodOption[] }>("/api/payment-methods");
}

/** Public feed — used client-side (e.g. checkout) where the server-rendered storefront helper in
 * lib/api/storefront.ts isn't available. */
export function getActivePaymentMethods() {
  return apiFetch<{ methods: PaymentMethodOption[] }>("/api/payment-methods/active");
}

export function createPaymentMethod(input: CreatePaymentMethodInput) {
  return apiFetch<{ method: PaymentMethodOption }>("/api/payment-methods", { method: "POST", body: input });
}

export function updatePaymentMethod(id: string, input: UpdatePaymentMethodInput) {
  return apiFetch<{ method: PaymentMethodOption }>(`/api/payment-methods/${id}`, { method: "PATCH", body: input });
}

export function deletePaymentMethod(id: string) {
  return apiFetch<void>(`/api/payment-methods/${id}`, { method: "DELETE" });
}

export function reorderPaymentMethods(input: ReorderPaymentMethodsInput) {
  return apiFetch<void>("/api/payment-methods/reorder", { method: "POST", body: input });
}

export function uploadPaymentMethodLogo(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch<{ url: string }>("/api/payment-methods/upload-logo", {
    method: "POST",
    body: formData,
    isFormData: true,
  });
}
