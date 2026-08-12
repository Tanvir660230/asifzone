import { useWishlistStore } from "@/store/wishlist";
import { addToWishlist } from "@/lib/api/wishlist";

/** Called right after a customer logs in or registers — pushes anything they wishlisted as a guest
 * (stored locally in useWishlistStore) up to their new/existing account, then clears the local copy
 * so it stops shadowing the now-authoritative server list. Best-effort: one item failing (e.g. the
 * product was removed since) doesn't block the rest, and a total failure just leaves the local
 * wishlist in place to retry on the next login rather than losing it. */
export async function mergeGuestWishlist(): Promise<void> {
  const { productIds, clear } = useWishlistStore.getState();
  if (productIds.length === 0) return;
  const results = await Promise.allSettled(productIds.map((id) => addToWishlist(id)));
  if (results.some((r) => r.status === "fulfilled")) clear();
}
