/**
 * Sellable availability (D5, docs/INVENTORY_INVARIANTS.md): a product that doesn't track inventory is always
 * available, whatever its stock number says; a tracked one is available up to its stock. The quote engine, the order
 * path and the storefront pickers all use these — nothing else decides "can this be bought in this quantity".
 */
/** The most units of one variant a single order line may hold (mirrors checkoutItemSchema's max). */
export const MAX_LINE_QUANTITY = 20;

export function isAvailable(trackInventory: boolean, stock: number, quantity = 1): boolean {
  return !trackInventory || stock >= quantity;
}

/** The largest quantity a shopper may pick for one variant (0 = can't be bought now). */
export function maxSellableQuantity(trackInventory: boolean, stock: number): number {
  return trackInventory ? Math.max(0, Math.min(stock, MAX_LINE_QUANTITY)) : MAX_LINE_QUANTITY;
}

/**
 * Stock state for the storefront read model (docs/STOREFRONT_READ_MODEL.md §4). A pure derivation of the canonical
 * inventory state (ProductVariant.stock, written only by inventory.service) plus the product's own settings — never
 * stored, never a second inventory writer.
 *   UNLIMITED     trackInventory = false (D5): always sellable, whatever the stock number says
 *   OUT_OF_STOCK  tracked and nothing sellable
 *   LOW_STOCK     tracked, sellable, and at or below the product's lowStockThreshold (the same threshold the admin
 *                 low-stock alert uses)
 *   IN_STOCK      otherwise
 */
export type StockState = "UNLIMITED" | "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export function variantStockState(trackInventory: boolean, stock: number, lowStockThreshold: number): StockState {
  if (!trackInventory) return "UNLIMITED";
  if (stock <= 0) return "OUT_OF_STOCK";
  return stock <= lowStockThreshold ? "LOW_STOCK" : "IN_STOCK";
}

export interface VariantAvailability {
  state: StockState;
  /** Can at least one unit be bought now (`isAvailable`). */
  sellable: boolean;
  /** Largest quantity one order line may hold now (`maxSellableQuantity`). */
  maxQuantity: number;
}

export interface ProductAvailability {
  state: StockState;
  /** At least one active variant can be bought now. */
  inStock: boolean;
  /** Σ stock of the active variants that can be sold; null when inventory isn't tracked (unlimited). */
  sellableUnits: number | null;
  variants: Record<string, VariantAvailability>;
}

/** Product-level availability over its ACTIVE variants only (inactive variants are never offered). */
export function productAvailability(input: {
  trackInventory: boolean;
  lowStockThreshold: number;
  variants: Array<{ id: string; stock: number; isActive?: boolean }>;
}): ProductAvailability {
  const active = input.variants.filter((v) => v.isActive !== false);
  const variants: Record<string, VariantAvailability> = {};
  for (const v of active) {
    variants[v.id] = {
      state: variantStockState(input.trackInventory, v.stock, input.lowStockThreshold),
      sellable: isAvailable(input.trackInventory, v.stock),
      maxQuantity: maxSellableQuantity(input.trackInventory, v.stock),
    };
  }
  const inStock = Object.values(variants).some((v) => v.sellable);
  if (!input.trackInventory) return { state: "UNLIMITED", inStock: active.length > 0, sellableUnits: null, variants };
  const sellableUnits = active.reduce((sum, v) => sum + Math.max(0, v.stock), 0);
  const state: StockState = !inStock ? "OUT_OF_STOCK" : sellableUnits <= input.lowStockThreshold ? "LOW_STOCK" : "IN_STOCK";
  return { state, inStock, sellableUnits, variants };
}
