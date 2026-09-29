import type { QuoteDto, QuoteRequestInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

/** The canonical server quote (POST /api/v1/checkout/quote) — the ONLY source of cart/checkout money in the web app.
 * Send what to price (variant ids, quantities, coupon code, address); never a price. */
export function getQuote(body: QuoteRequestInput) {
  return apiFetch<{ quote: QuoteDto }>("/api/v1/checkout/quote", { method: "POST", body });
}

/** The same quote with the best coupon this cart already qualifies for applied (null when none helps). */
export function getBestCouponQuote(body: QuoteRequestInput) {
  return apiFetch<{ quote: QuoteDto | null }>("/api/v1/checkout/quote/best-coupon", { method: "POST", body });
}
