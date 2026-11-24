import type { CaptureCheckoutLeadInput, CheckoutLeadDto, CheckoutLeadSummary, RecordCheckoutLeadActionInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

/** Incomplete orders (docs/INCOMPLETE_ORDERS.md). Storefront: what the shopper has typed, fire-and-forget — a failure is
 * never shown (the shopper is just filling in a form). */
export function captureCheckoutLead(input: CaptureCheckoutLeadInput): void {
  apiFetch<{ ok: true }>("/api/checkout-leads/capture", { method: "POST", body: input }).catch(() => undefined);
}

export interface ResumedLead {
  name: string | null;
  phone: string;
  email: string | null;
  shippingDistrict: string | null;
  shippingArea: string | null;
  shippingAddressLine: string | null;
  items: Array<{
    variantId: string;
    productId: string;
    productSlug: string;
    productName: string;
    sku: string;
    size: string;
    color: string;
    price: number;
    imageUrl: string | null;
    quantity: number;
    maxStock: number;
  }>;
}

export function resumeCheckoutLead(code: string) {
  return apiFetch<{ lead: ResumedLead }>(`/api/checkout-leads/resume/${encodeURIComponent(code)}`);
}

// --- admin ---

export function listCheckoutLeads(view: "open" | "closed") {
  return apiFetch<{ leads: CheckoutLeadDto[] }>(`/api/checkout-leads?view=${view}`);
}

export function getCheckoutLead(id: string) {
  return apiFetch<{ lead: CheckoutLeadDto }>(`/api/checkout-leads/${id}`);
}

export function getCheckoutLeadSummary(days = 30) {
  return apiFetch<CheckoutLeadSummary>(`/api/checkout-leads/summary?days=${days}`);
}

export function recordCheckoutLeadAction(id: string, input: RecordCheckoutLeadActionInput) {
  return apiFetch<{ lead: CheckoutLeadDto }>(`/api/checkout-leads/${id}/actions`, { method: "POST", body: input });
}
