import type { Product, VariantPricing } from "@clothing-brand/shared";

/**
 * Display-only access to SERVER-resolved prices (docs/PRICING_INVARIANTS.md §3). Every storefront price comes from
 * `product.pricing` (the canonical pricing engine); this file only picks which of those numbers to show. It never
 * computes a price — the only fallback is the stored list price, for a read model without `pricing` (e.g. an admin row).
 */
export interface DisplayPrice {
  /** What the shopper pays now. */
  price: number | string;
  /** Struck-through "was" price, when one applies. */
  was: number | string | null;
  flash: VariantPricing["flash"];
}

/** The product-level ("from") price. */
export function productDisplayPrice(product: Pick<Product, "pricing" | "basePrice" | "compareAtPrice">): DisplayPrice {
  const p = product.pricing;
  if (p) return { price: p.from, was: p.flash ? p.listFrom : p.compareAt, flash: p.flash };
  return { price: product.basePrice, was: product.compareAtPrice, flash: null };
}

/** One variant's price; falls back to the product price before a variant is chosen. */
export function variantDisplayPrice(product: Pick<Product, "pricing" | "basePrice" | "compareAtPrice">, variantId: string | null | undefined): DisplayPrice {
  const v = variantId ? product.pricing?.variants[variantId] : undefined;
  if (v) return { price: v.selling, was: v.flash ? v.list : v.compareAt, flash: v.flash };
  return productDisplayPrice(product);
}

/** "% off" label between two server-resolved numbers (a presentation label, not a price). */
export function percentOffLabel(price: number | string, was: number | string | null): number | null {
  if (was === null || Number(was) <= 0 || Number(price) >= Number(was)) return null;
  return Math.round((1 - Number(price) / Number(was)) * 100);
}
