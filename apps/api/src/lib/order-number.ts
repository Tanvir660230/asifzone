import crypto from "crypto";

/** e.g. ORD-20260804-1KX9F2 — date-prefixed for readability, random suffix to avoid a DB round trip
 * for uniqueness. Uses crypto.randomInt (not Math.random) because this is customer-facing and used
 * to look up an order (trackOrder, retryPayment) by number+phone — a predictable suffix would make
 * same-day order numbers guessable within those routes' rate limits. (Payment callbacks are now
 * looked up by PaymentSession.gatewayTransactionRef, a separate crypto.randomUUID()-based value —
 * see payment.service.ts — not by this order number.) 36^6 (~2.18 billion) combinations per day. */
export function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = crypto
    .randomInt(36 ** 6)
    .toString(36)
    .toUpperCase()
    .padStart(6, "0");
  return `ORD-${date}-${suffix}`;
}
