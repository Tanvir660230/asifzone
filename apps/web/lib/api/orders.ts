import type { CheckoutInput, Order, PublicPaymentLinkView } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

// `order` is only present for COD (created immediately); every other payment method returns just
// `gatewayUrl` — the Order isn't materialized until the gateway confirms success server-side.
/** `idempotencyKey`: the same key on a retry returns the first attempt's order / payment session (Phase 9). */
export function createOrder(input: CheckoutInput, idempotencyKey?: string) {
  return apiFetch<{ order?: Order; gatewayUrl?: string }>("/api/orders", { method: "POST", body: input, idempotencyKey });
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

// ─── Payment links (docs/ORDER_ADJUSTMENTS.md §11) — public; the token in the URL is the only key ────────────────────

export function getPaymentLink(token: string) {
  return apiFetch<{ link: PublicPaymentLinkView }>(`/api/pay/${encodeURIComponent(token)}`);
}

export function startPaymentLink(token: string, provider: "SSLCOMMERZ" | "EPS_PG") {
  return apiFetch<{ gatewayUrl: string }>(`/api/pay/${encodeURIComponent(token)}/start`, { method: "POST", body: { provider } });
}

// ─── The customer's confirm-your-order link from the order-placed SMS — public; the signed code is the key ──────────

export interface SelfConfirmView {
  orderNumber: string;
  status: string;
  total: number;
  shippingArea: string;
  items: { name: string; variantLabel: string; quantity: number; imageUrl: string | null }[];
  canAct: boolean;
}

export function getSelfConfirm(code: string) {
  return apiFetch<{ order: SelfConfirmView }>(`/api/order-confirm/${encodeURIComponent(code)}`);
}

export function actOnSelfConfirm(code: string, action: "confirm" | "cancel") {
  return apiFetch<{ order: SelfConfirmView }>(`/api/order-confirm/${encodeURIComponent(code)}`, { method: "POST", body: { action } });
}

// ─── The customer's review link from the SMS two days after delivery — public; the signed code is the key ───────────

export interface ReviewLinkView {
  orderNumber: string;
  firstName: string;
  canReview: boolean;
  items: { productId: string; name: string; imageUrl: string | null; reviewed: boolean; rating: number | null }[];
}

export function getReviewLink(code: string) {
  return apiFetch<{ order: ReviewLinkView }>(`/api/review-link/${encodeURIComponent(code)}`);
}

export function submitReviewLink(code: string, input: { productId: string; rating: number; body?: string }) {
  return apiFetch<{ review: { id: string; rating: number; status: string } }>(`/api/review-link/${encodeURIComponent(code)}`, { method: "POST", body: input });
}
