import { sessionGet, sessionSet } from "@/lib/safe-storage";

/** Details an incomplete order's resume link brought back (docs/INCOMPLETE_ORDERS.md), for the checkout form to fill in
 * once. Session storage only — gone when the tab closes. */
const KEY = "checkoutPrefill";

export interface CheckoutPrefill {
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  shippingDistrict?: string;
  shippingArea?: string;
  shippingAddressLine?: string;
}

export function saveCheckoutPrefill(prefill: CheckoutPrefill) {
  sessionSet(KEY, JSON.stringify(prefill));
}

/** What a resume link left for the checkout form (null when nothing). Doesn't remove it — `clearCheckoutPrefill` does,
 * once the form has used it (a render may run twice in development). */
export function peekCheckoutPrefill(): CheckoutPrefill | null {
  if (typeof window === "undefined") return null;
  const raw = sessionGet(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CheckoutPrefill;
  } catch {
    return null;
  }
}

export function clearCheckoutPrefill() {
  sessionSet(KEY, "");
}
