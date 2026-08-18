import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncCart } from "@/lib/api/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { trackFunnelEvent } from "@/lib/analytics";

export interface CartItem {
  variantId: string;
  productId: string;
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
  /** Bumped on every mutation — drives the on-site "still interested?" reminder, purely local. */
  lastActivityAt: number;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  removeItem: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  clear: () => void;
}

const SYNC_DEBOUNCE_MS = 800;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced, fire-and-forget mirror to the server (logged-in customers only — silently
 * ignored for guests). Never awaited by the store; the local cart is always authoritative. */
function scheduleSync(items: CartItem[]) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncCart(items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })));
  }, SYNC_DEBOUNCE_MS);
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      lastActivityAt: Date.now(),

      addItem: (item, quantity = 1) => {
        set((state) => {
          const existing = state.items.find((i) => i.variantId === item.variantId);
          if (existing) {
            const nextQty = Math.min(existing.quantity + quantity, existing.maxStock);
            return {
              items: state.items.map((i) => (i.variantId === item.variantId ? { ...i, quantity: nextQty } : i)),
              lastActivityAt: Date.now(),
            };
          }
          return {
            items: [...state.items, { ...item, quantity: Math.min(quantity, item.maxStock) }],
            lastActivityAt: Date.now(),
          };
        });
        scheduleSync(get().items);
        // Surface the drawer as visual confirmation of what was just added — this is the
        // shopper's main feedback that the click registered, since there's no page navigation.
        useCartDrawerStore.getState().open();
      },

      removeItem: (variantId) => {
        // Looked up before filtering — the one canonical place cart removal happens (cart drawer
        // and cart page both call this same action), so this is also the one place a
        // REMOVE_FROM_CART event needs to fire, regardless of which UI triggered it.
        const removed = get().items.find((i) => i.variantId === variantId);
        set((state) => ({ items: state.items.filter((i) => i.variantId !== variantId), lastActivityAt: Date.now() }));
        scheduleSync(get().items);
        if (removed) trackFunnelEvent("REMOVE_FROM_CART", { productId: removed.productId, variantId: removed.variantId });
      },

      updateQuantity: (variantId, quantity) => {
        set((state) => ({
          items: state.items
            .map((i) => (i.variantId === variantId ? { ...i, quantity: Math.min(quantity, i.maxStock) } : i))
            .filter((i) => i.quantity > 0),
          lastActivityAt: Date.now(),
        }));
        scheduleSync(get().items);
      },

      clear: () => {
        set({ items: [], lastActivityAt: Date.now() });
        scheduleSync([]);
      },
    }),
    { name: "cart-storage" },
  ),
);

export const useCartCount = () => useCartStore((state) => state.items.reduce((sum, i) => sum + i.quantity, 0));
export const useCartSubtotal = () =>
  useCartStore((state) => state.items.reduce((sum, i) => sum + i.price * i.quantity, 0));
