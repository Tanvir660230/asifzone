import { create } from "zustand";
import type { Product } from "@clothing-brand/shared";

interface QuickViewState {
  product: Product | null;
  open: (product: Product) => void;
  close: () => void;
}

export const useQuickViewStore = create<QuickViewState>()((set) => ({
  product: null,
  open: (product) => set({ product }),
  close: () => set({ product: null }),
}));
