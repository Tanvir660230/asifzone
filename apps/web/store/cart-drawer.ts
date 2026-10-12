import { create } from "zustand";

/** What was just put in the bag, for the "Added to bag" confirmation (components/storefront/added-to-bag.tsx). */
export interface AddedToBag {
  productName: string;
  productSlug: string;
  size: string;
  color: string;
  imageUrl: string | null;
  /** How many units this add actually put in the bag (after the stock clamp). */
  quantity: number;
  /** Changes on every add, so adding the same item twice re-shows the confirmation. */
  at: number;
}

interface CartDrawerState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  added: AddedToBag | null;
  showAdded: (added: Omit<AddedToBag, "at">) => void;
  dismissAdded: () => void;
}

export const useCartDrawerStore = create<CartDrawerState>()((set) => ({
  isOpen: false,
  // Opening the bag replaces the confirmation: the bag itself shows what was added.
  open: () => set({ isOpen: true, added: null }),
  close: () => set({ isOpen: false }),
  added: null,
  showAdded: (added) => set({ added: { ...added, at: Date.now() } }),
  dismissAdded: () => set({ added: null }),
}));
