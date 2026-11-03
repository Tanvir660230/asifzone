import type { Product, ProductPricing, VariantPricing } from "./types";

/* Collection landing pages (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §2): one campaign page that sells several products
   as if they were one — e.g. six single-colour jackets behind one colour picker — without grouping them. Every variant
   still belongs to its own product (its own SKU, stock, price and order lines); only the page shows them together. The
   API (which colours a default may name) and the storefront (what the shopper picks from) use the same labels. */

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Haven Full-Sleeve Jacket – Onyx Black" → "Haven Full-Sleeve Jacket": a product's name without its colour suffix. */
function nameWithoutColor(name: string, color: string): string {
  if (!color) return name;
  const short = name.replace(new RegExp(`\\s*[–—-]\\s*${escapeRegExp(color)}\\s*$`, "i"), "").trim();
  return short || name;
}

/**
 * The colour each variant shows under on a collection page, by variant id. A colour keeps its own name the first time it
 * appears; the same colour from a later product is told apart by that product's name ("Onyx Black (Haven Full-Sleeve
 * Jacket)"), so two products never fold into one choice. A product without a colour is chosen by its name.
 */
export function landingColorLabels(products: Array<{ name: string; variants: Array<{ id: string; color: string | null }> }>): Map<string, string> {
  const labels = new Map<string, string>();
  const taken = new Set<string>();
  for (const product of products) {
    const own = new Map<string, string>();
    for (const v of product.variants) {
      const color = (v.color ?? "").trim();
      let label = own.get(color);
      if (label === undefined) {
        label = !color ? product.name : taken.has(color) ? `${color} (${nameWithoutColor(product.name, color)})` : color;
        own.set(color, label);
      }
      labels.set(v.id, label);
    }
    for (const label of own.values()) taken.add(label);
    for (const color of own.keys()) if (color) taken.add(color);
  }
  return labels;
}

/** A variant's server-resolved price, or one built from its product's stored prices when the API sent no pricing. */
function pricingOf(product: Product, variant: Product["variants"][number]): VariantPricing {
  const resolved = product.pricing?.variants[variant.id];
  if (resolved) return resolved;
  const selling = Number(variant.price ?? product.basePrice);
  const was = variant.compareAtPrice ?? product.compareAtPrice;
  return { list: selling, selling, compareAt: was == null ? null : Number(was), flash: null };
}

/**
 * The products of a collection page as one product: the main product's id, reviews and description (tracking and
 * "more products" stay the main product's), every product's variants and photos, and each variant's own price. A variant
 * without photos of its own is linked to its product's photos, so the gallery follows the chosen colour. `displayName`
 * replaces the main product's name as the page's title. Nothing here changes a price — every number is the server's.
 */
export function mergeLandingProducts(main: Product, extras: Product[], displayName?: string | null): Product {
  const named = displayName?.trim() ? { ...main, name: displayName.trim() } : main;
  if (!extras.length) return displayName?.trim() ? named : main;

  const all = [main, ...extras];
  const labels = landingColorLabels(all);
  const variants = all.flatMap((p) =>
    p.variants.map((v) => ({
      ...v,
      color: labels.get(v.id) ?? v.color,
      images: v.imageId || v.images?.length ? v.images : p.images.map((img, i) => ({ imageId: img.id, sortOrder: i })),
    })),
  );
  const seen = new Set<string>();
  const images = all.flatMap((p) => p.images).filter((img) => !seen.has(img.id) && seen.add(img.id));

  const prices: Record<string, VariantPricing> = {};
  for (const p of all) for (const v of p.variants) prices[v.id] = pricingOf(p, v);
  const offered = variants.filter((v) => v.isActive !== false).map((v) => prices[v.id]!);
  const list = offered.length ? offered : Object.values(prices);
  const cheapest = list.reduce((a, b) => (b.selling < a.selling ? b : a), list[0]!);
  const pricing: ProductPricing = {
    currency: main.pricing?.currency ?? extras.find((p) => p.pricing)?.pricing?.currency ?? "BDT",
    from: cheapest.selling,
    to: Math.max(...list.map((p) => p.selling)),
    listFrom: Math.min(...list.map((p) => p.list)),
    compareAt: cheapest.compareAt,
    flash: cheapest.flash,
    variants: prices,
  };

  return { ...named, variants, images, pricing };
}
