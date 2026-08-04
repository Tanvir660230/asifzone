import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartItem {
  variantId: string;
  productSlug: string;
  productName: string;
  sku: string;
  size: string;
  color: string;
  price: number;
  imageUrl: string | null;
  quantity: number;
  maxStock: number;
}

interface CartState {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  removeItem: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],

      addItem: (item, quantity = 1) =>
        set((state) => {
          const existing = state.items.find((i) => i.variantId === item.variantId);
          if (existing) {
            const nextQty = Math.min(existing.quantity + quantity, existing.maxStock);
            return {
              items: state.items.map((i) => (i.variantId === item.variantId ? { ...i, quantity: nextQty } : i)),
            };
          }
          return { items: [...state.items, { ...item, quantity: Math.min(quantity, item.maxStock) }] };
        }),

      removeItem: (variantId) => set((state) => ({ items: state.items.filter((i) => i.variantId !== variantId) })),

      updateQuantity: (variantId, quantity) =>
        set((state) => ({
          items: state.items
            .map((i) => (i.variantId === variantId ? { ...i, quantity: Math.min(quantity, i.maxStock) } : i))
            .filter((i) => i.quantity > 0),
        })),

      clear: () => set({ items: [] }),
    }),
    { name: "cart-storage" },
  ),
);

export const useCartCount = () => useCartStore((state) => state.items.reduce((sum, i) => sum + i.quantity, 0));
export const useCartSubtotal = () =>
  useCartStore((state) => state.items.reduce((sum, i) => sum + i.price * i.quantity, 0));
