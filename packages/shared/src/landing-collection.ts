import type { Product, ProductPricing, VariantPricing } from "./types";

/* Collection landing pages (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §2): one campaign page that sells several products
   as if they were one — e.g. six single-colour jackets behind one colour picker — without grouping them. Every variant
   still belongs to its own product (its own SKU, stock, price and order lines); only the page shows them together. The
   API (which colours a default may name) and the storefront (what the shopper picks from) use the same labels. */

const SEPARATORS = /^[\s–—\-:|·,]+|[\s–—\-:|·,]+$/g;

/** The words every name starts with ("Premium Pakistani Cap -"), so each product can be called by what sets it apart. */
function commonPrefixWords(names: string[]): number {
  const split = names.map((n) => n.trim().split(/\s+/));
  let n = 0;
  while (split.every((w) => w.length > n + 1 && w[n]!.toLowerCase() === split[0]![n]!.toLowerCase())) n++;
  return n;
}

/**
 * Each name without the words every name starts with: ["Premium Pakistani Cap - New White C", "Premium Pakistani Cap -
 * Black B"] → ["New White C", "Black B"]. A single name, or one that would be left empty, stays whole. Used for collection
 * landing pages and for product-family tiles, so a product is called the same thing on both.
 */
export function distinctNames(names: string[]): string[] {
  const skip = names.length > 1 ? commonPrefixWords(names) : 0;
  return names.map((name) => name.trim().split(/\s+/).slice(skip).join(" ").replace(SEPARATORS, "") || name);
}

/**
 * The colour each variant shows under on a collection page, by variant id. A colour only one product has keeps its own
 * name ("Olive Green"). A colour several products share — the same colour in different designs — is called by what sets
 * each product apart: its name without the words all the page's names start with ("Premium Pakistani Cap - New Black D"
 * → "New Black D"), with the colour in front when that product comes in more than one colour. Two products never fold
 * into one choice. A product without a colour is chosen by its name the same way.
 */
export function landingColorLabels(products: Array<{ name: string; variants: Array<{ id: string; color: string | null }> }>): Map<string, string> {
  const colorsOf = products.map((p) => [...new Set(p.variants.map((v) => (v.color ?? "").trim()))]);
  const owners = new Map<string, number>();
  for (const colors of colorsOf) for (const c of colors) owners.set(c, (owners.get(c) ?? 0) + 1);
  const distinct = distinctNames(products.map((p) => p.name));

  const labels = new Map<string, string>();
  const used = new Set<string>();
  products.forEach((product, i) => {
    const own = new Map<string, string>();
    for (const v of product.variants) {
      const color = (v.color ?? "").trim();
      let label = own.get(color);
      if (label === undefined) {
        label = !color ? distinct[i]! : (owners.get(color) ?? 0) < 2 ? color : colorsOf[i]!.length > 1 ? `${color} (${distinct[i]})` : distinct[i]!;
        // Still taken (two products with the same name): the full name tells them apart.
        if (used.has(label)) label = color ? `${color} (${product.name})` : product.name;
        own.set(color, label);
      }
      labels.set(v.id, label);
    }
    for (const label of own.values()) used.add(label);
  });
  return labels;
}

/** "XS 21", "XS/21" and "xs - 21" are one size: the spelling the page met first is the one it shows. */
const sizeKey = (size: string) => size.trim().toLowerCase().replace(/[\s/\-_]+/g, "");

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
  const sizeSpelling = new Map<string, string>();
  for (const p of all) for (const v of p.variants) if (v.size && !sizeSpelling.has(sizeKey(v.size))) sizeSpelling.set(sizeKey(v.size), v.size);
  const variants = all.flatMap((p) =>
    p.variants.map((v) => ({
      ...v,
      color: labels.get(v.id) ?? v.color,
      // Shown only — the order still goes by the variant's id, and its order line keeps its own size.
      size: v.size ? (sizeSpelling.get(sizeKey(v.size)) ?? v.size) : v.size,
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
    // The store's currency as the server sent it; no price is formatted from this, the storefront uses its own setting.
    currency: main.pricing?.currency ?? extras.find((p) => p.pricing)?.pricing?.currency ?? "",
    from: cheapest.selling,
    to: Math.max(...list.map((p) => p.selling)),
    listFrom: Math.min(...list.map((p) => p.list)),
    compareAt: cheapest.compareAt,
    flash: cheapest.flash,
    variants: prices,
  };

  return { ...named, variants, images, pricing };
}
