import type { Coupon } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

// Applying or suggesting a coupon at checkout goes through the server quote (lib/api/quote.ts) — the coupon's effect is
// whatever the canonical pricing pipeline says it is, never a client-side subtotal.

/** Every currently-usable coupon — powers the account "Coupons" page. */
export function listActiveCoupons() {
  return apiFetch<{ coupons: Coupon[] }>("/api/coupons/active");
}
