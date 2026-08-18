import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CartItem } from "./cart";

/** Holds the single item a "Buy Now" click should check out with — deliberately separate from
 * (and never synced like) the cart store, so Buy Now never touches or is affected by the
 * shopper's real cart.
 *
 * Persisted to sessionStorage (not just in-memory): an online-payment attempt sends the shopper
 * to the gateway via a real `window.location.href` navigation, which unloads the page and wipes
 * any unpersisted state. Without this, a failed/cancelled Buy Now payment redirected back to
 * /checkout with no express item and an empty cart underneath it, rendering "Your cart is empty"
 * instead of letting the shopper retry. sessionStorage (not localStorage, unlike cart-storage)
 * so it still clears on tab close rather than lingering like a real cart would. */
interface ExpressCheckoutState {
  item: CartItem | null;
  setItem: (item: CartItem) => void;
  clear: () => void;
}

export const useExpressCheckoutStore = create<ExpressCheckoutState>()(
  persist(
    (set) => ({
      item: null,
      setItem: (item) => set({ item }),
      clear: () => set({ item: null }),
    }),
    { name: "express-checkout-storage", storage: createJSONStorage(() => sessionStorage) },
  ),
);
