import { productAvailability, type Product, type ProductAvailability, type VariantAvailability } from "@clothing-brand/shared";

/**
 * Display-only access to the SERVER-derived availability (docs/STOREFRONT_READ_MODEL.md §4). Every storefront read
 * carries `product.availability` from the Storefront Read Model; the storefront renders it and never re-decides stock
 * state. The fallback — for objects that don't come from a storefront read (e.g. the admin wizard's preview of unsaved
 * values) — runs the same shared function the server uses, never a local rule.
 */
type AvailabilitySource = Pick<Product, "availability" | "trackInventory" | "lowStockThreshold" | "variants">;

export function availabilityOf(product: AvailabilitySource): ProductAvailability {
  return product.availability ?? productAvailability({ trackInventory: product.trackInventory, lowStockThreshold: product.lowStockThreshold, variants: product.variants });
}

export function variantAvailabilityOf(product: AvailabilitySource, variantId: string): VariantAvailability | null {
  return availabilityOf(product).variants[variantId] ?? null;
}
