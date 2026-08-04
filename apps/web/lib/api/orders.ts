import type { CheckoutInput, Order } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function createOrder(input: CheckoutInput) {
  return apiFetch<{ order: Order; gatewayUrl?: string }>("/api/orders", { method: "POST", body: input });
}

/** Guest tracking — the phone number on the order must match, so an order number alone can't expose someone else's address. */
export function trackOrder(orderNumber: string, phone: string) {
  return apiFetch<{ order: Order }>("/api/orders/track", { method: "POST", body: { orderNumber, phone } });
}
