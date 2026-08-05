import type { SyncCartInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

/** Fire-and-forget mirror of the client cart to the server, for a logged-in customer only —
 * 401 (guest) is expected and ignored. Never read back into the UI; purely powers abandoned-
 * cart recovery. */
export function syncCart(items: SyncCartInput["items"]): void {
  apiFetch<void>("/api/cart", { method: "PUT", body: { items } }).catch(() => {
    // guest, offline, or a transient failure — the local cart is unaffected either way
  });
}

export function subscribeStockAlert(variantId: string) {
  return apiFetch<{ ok: true }>("/api/stock-alerts", { method: "POST", body: { variantId } });
}

export function unsubscribeStockAlert(variantId: string) {
  return apiFetch<void>(`/api/stock-alerts/${variantId}`, { method: "DELETE" });
}
