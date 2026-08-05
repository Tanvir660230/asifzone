import { create } from "zustand";
import type { CartItem } from "./cart";

/** Holds the single item a "Buy Now" click should check out with — deliberately separate from
 * (and never persisted/synced like) the cart store, so Buy Now never touches or is affected by
 * the shopper's real cart. */
interface ExpressCheckoutState {
  item: CartItem | null;
  setItem: (item: CartItem) => void;
  clear: () => void;
}

export const useExpressCheckoutStore = create<ExpressCheckoutState>()((set) => ({
  item: null,
  setItem: (item) => set({ item }),
  clear: () => set({ item: null }),
}));
