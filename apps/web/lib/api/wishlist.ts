import type { WishlistItem } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listWishlist() {
  return apiFetch<{ items: WishlistItem[] }>("/api/wishlist");
}

export function addToWishlist(productId: string) {
  return apiFetch<{ ok: true }>("/api/wishlist", { method: "POST", body: { productId } });
}

export function removeFromWishlist(productId: string) {
  return apiFetch<void>(`/api/wishlist/${productId}`, { method: "DELETE" });
}
