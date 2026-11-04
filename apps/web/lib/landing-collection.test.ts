import { describe, expect, it } from "vitest";
import { landingColorLabels, mergeLandingProducts, type Product } from "@clothing-brand/shared";

// A collection landing page (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §2): several products shown as one, each colour
// keeping its own photos and its own server-resolved price, while every variant still belongs to its own product.

function product(id: string, name: string, color: string, price: number, opts: { imageIds?: string[]; trackInventory?: boolean } = {}): Product {
  const images = (opts.imageIds ?? [`${id}-img`]).map((imgId, i) => ({ id: imgId, url: `/uploads/${imgId}.webp`, altText: null, sortOrder: i }));
  const variants = ["M", "L"].map((size) => ({ id: `${id}-${size}`, sku: `${id}-${size}`, size, color, colorHex: "#111111", stock: 5, price: null, compareAtPrice: null, isActive: true, imageId: null, images: [] }));
  return {
    id,
    name,
    slug: id,
    basePrice: String(price),
    compareAtPrice: null,
    trackInventory: opts.trackInventory ?? false,
    images,
    variants,
    pricing: {
      currency: "BDT",
      from: price,
      to: price,
      listFrom: price,
      compareAt: price + 600,
      flash: null,
      variants: Object.fromEntries(variants.map((v) => [v.id, { list: price, selling: price, compareAt: price + 600, flash: null }])),
    },
  } as unknown as Product;
}

describe("landingColorLabels", () => {
  it("keeps a colour only one product has, and calls shared colours by what sets each product apart", () => {
    const labels = landingColorLabels([
      { name: "Haven Sleeveless Jacket – Onyx Black", variants: [{ id: "a", color: "Onyx Black" }] },
      { name: "Haven Full-Sleeve Jacket – Onyx Black", variants: [{ id: "b", color: "Onyx Black" }] },
      { name: "Haven Sleeveless Jacket – Olive Green", variants: [{ id: "c", color: "Olive Green" }] },
    ]);
    // "Haven" starts every name, so it is left off.
    expect(labels.get("a")).toBe("Sleeveless Jacket – Onyx Black");
    expect(labels.get("b")).toBe("Full-Sleeve Jacket – Onyx Black");
    expect(labels.get("c")).toBe("Olive Green");
  });

  it("names caps of one colour in several designs by their design", () => {
    const labels = landingColorLabels([
      { name: "Premium Pakistani Cap - New White C", variants: [{ id: "wc", color: "White" }] },
      { name: "Premium Pakistani Cap - New Black C", variants: [{ id: "bc", color: "Black" }] },
      { name: "Premium Pakistani Cap - White B", variants: [{ id: "wb", color: "White" }] },
      { name: "Premium Pakistani Cap - Black B", variants: [{ id: "bb", color: "Black" }] },
    ]);
    expect([...new Set(labels.values())]).toEqual(["New White C", "New Black C", "White B", "Black B"]);
  });

  it("keeps the colour in front for a product with several colours, and names a colourless product", () => {
    const labels = landingColorLabels([
      { name: "Tee Classic", variants: [{ id: "r", color: "Red" }, { id: "k", color: "Black" }] },
      { name: "Tee Slim", variants: [{ id: "s", color: "Black" }] },
      { name: "Plain Tee", variants: [{ id: "d", color: "" }] },
    ]);
    expect(labels.get("r")).toBe("Red");
    expect(labels.get("k")).toBe("Black (Tee Classic)");
    expect(labels.get("s")).toBe("Tee Slim");
    expect(labels.get("d")).toBe("Plain Tee");
  });
});

describe("mergeLandingProducts", () => {
  const navy = product("navy", "Haven Sleeveless Jacket – Midnight Navy", "Midnight Navy", 1390);
  const black = product("black", "Haven Full-Sleeve Jacket – Onyx Black", "Onyx Black", 1590);

  it("is the product itself when there is nothing to add", () => {
    expect(mergeLandingProducts(navy, [])).toBe(navy);
    expect(mergeLandingProducts(navy, [], "Haven jackets").name).toBe("Haven jackets");
  });

  it("offers every product's variants, each with its own photos and price", () => {
    const merged = mergeLandingProducts(navy, [black], "Haven jackets");
    expect(merged.id).toBe("navy"); // tracking keeps the main product's id
    expect(merged.name).toBe("Haven jackets");
    expect(merged.variants.map((v) => `${v.color}/${v.size}`)).toEqual(["Midnight Navy/M", "Midnight Navy/L", "Onyx Black/M", "Onyx Black/L"]);
    expect(merged.images.map((i) => i.id)).toEqual(["navy-img", "black-img"]);
    // A colour's photos follow it: each variant is linked to its own product's photos.
    expect(merged.variants.find((v) => v.id === "black-M")!.images).toEqual([{ imageId: "black-img", sortOrder: 0 }]);
    expect(merged.variants.find((v) => v.id === "navy-L")!.images).toEqual([{ imageId: "navy-img", sortOrder: 0 }]);
    // Prices stay the server's, per variant; "from" is the lowest of them.
    expect(merged.pricing!.variants["black-L"]!.selling).toBe(1590);
    expect(merged.pricing!.variants["navy-M"]!.selling).toBe(1390);
    expect(merged.pricing).toMatchObject({ from: 1390, to: 1590, listFrom: 1390, compareAt: 1990 });
  });

  it("shows one size spelling for sizes written differently, without changing which variant is ordered", () => {
    const a = product("a", "Cap - White C", "White", 999);
    const b = product("b", "Cap - White B", "White", 999);
    a.variants = a.variants.map((v, i) => ({ ...v, size: ["XS/21", "S/21.5"][i]! }));
    b.variants = b.variants.map((v, i) => ({ ...v, size: ["XS 21", "2XL 23.5"][i]! }));
    const merged = mergeLandingProducts(a, [b]);
    expect(merged.variants.map((v) => `${v.id}:${v.size}`)).toEqual(["a-M:XS/21", "a-L:S/21.5", "b-M:XS/21", "b-L:2XL 23.5"]);
  });

  it("keeps a variant's own photo links when it has them", () => {
    const withOwn = product("own", "Own", "Red", 1000, { imageIds: ["own-1", "own-2"] });
    withOwn.variants[0] = { ...withOwn.variants[0]!, images: [{ imageId: "own-2", sortOrder: 0 }] };
    const merged = mergeLandingProducts(navy, [withOwn]);
    expect(merged.variants.find((v) => v.id === "own-M")!.images).toEqual([{ imageId: "own-2", sortOrder: 0 }]);
  });
});
