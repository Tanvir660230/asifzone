import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WishlistState {
  /** Guest-only wishlist, kept purely client-side (same philosophy as the cart store) — a logged-in
   * customer's wishlist lives on the server instead (see WishlistButton, which branches on login
   * state) and mergeGuestWishlist() moves anything saved here into the account right after login. */
  productIds: string[];
  toggle: (productId: string) => void;
  clear: () => void;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set) => ({
      productIds: [],
      toggle: (productId) =>
        set((state) => ({
          productIds: state.productIds.includes(productId)
            ? state.productIds.filter((id) => id !== productId)
            : [productId, ...state.productIds],
        })),
      clear: () => set({ productIds: [] }),
    }),
    { name: "wishlist-storage" },
  ),
);
