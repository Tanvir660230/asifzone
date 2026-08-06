import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Product } from "@clothing-brand/shared";

const MAX_COMPARE_ITEMS = 4;

interface CompareState {
  items: Product[];
  toggle: (product: Product) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

export const useCompareStore = create<CompareState>()(
  persist(
    (set, get) => ({
      items: [],
      toggle: (product) => {
        const exists = get().items.some((i) => i.id === product.id);
        if (exists) {
          set((state) => ({ items: state.items.filter((i) => i.id !== product.id) }));
          return;
        }
        set((state) => ({ items: [...state.items.slice(-(MAX_COMPARE_ITEMS - 1)), product] }));
      },
      remove: (productId) => set((state) => ({ items: state.items.filter((i) => i.id !== productId) })),
      clear: () => set({ items: [] }),
    }),
    { name: "compare-storage" },
  ),
);

export { MAX_COMPARE_ITEMS };
