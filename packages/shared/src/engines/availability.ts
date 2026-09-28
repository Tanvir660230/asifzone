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
