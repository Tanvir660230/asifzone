import { create } from "zustand";

/**
 * The product page's one-step order sheet. "Buy Now" puts its one item in the express-checkout store (as before) and,
 * where the sheet is on the page (a storefront page of a store taking Cash on Delivery), opens it there instead of
 * sending the shopper to /checkout. `available` is set by the mounted sheet itself, so a page without it still falls back
 * to the checkout page.
 */
interface QuickOrderState {
  available: boolean;
  open: boolean;
  setAvailable: (available: boolean) => void;
  show: () => void;
  close: () => void;
}

export const useQuickOrderStore = create<QuickOrderState>()((set) => ({
  available: false,
  open: false,
  setAvailable: (available) => set({ available }),
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));
