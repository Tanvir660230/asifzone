import type { CheckoutInput, Order } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

// `order` is only present for COD (created immediately); every other payment method returns just
// `gatewayUrl` — the Order isn't materialized until the gateway confirms success server-side.
export function createOrder(input: CheckoutInput) {
  return apiFetch<{ order?: Order; gatewayUrl?: string }>("/api/orders", { method: "POST", body: input });
}

/** Guest tracking — the phone number on the order must match, so an order number alone can't expose someone else's address. */
export function trackOrder(orderNumber: string, phone: string) {
  return apiFetch<{ order: Order }>("/api/orders/track", { method: "POST", body: { orderNumber, phone } });
}

/** Starts a fresh payment attempt on an existing PENDING order — same phone-match ownership check as trackOrder. */
export function retryPayment(orderNumber: string, phone: string) {
  return apiFetch<{ gatewayUrl: string }>(`/api/orders/${encodeURIComponent(orderNumber)}/retry-payment`, {
    method: "POST",
    body: { phone },
  });
}
