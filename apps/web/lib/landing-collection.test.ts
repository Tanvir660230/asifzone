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
  it("keeps a colour's own name and tells repeated colours apart by product name", () => {
    const labels = landingColorLabels([
      { name: "Haven Sleeveless Jacket – Onyx Black", variants: [{ id: "a", color: "Onyx Black" }] },
      { name: "Haven Full-Sleeve Jacket – Onyx Black", variants: [{ id: "b", color: "Onyx Black" }] },
      { name: "Haven Sleeveless Jacket – Olive Green", variants: [{ id: "c", color: "Olive Green" }] },
      { name: "Plain Tee", variants: [{ id: "d", color: "" }] },
    ]);
    expect(labels.get("a")).toBe("Onyx Black");
    expect(labels.get("b")).toBe("Onyx Black (Haven Full-Sleeve Jacket)");
    expect(labels.get("c")).toBe("Olive Green");
    // A product without a colour is chosen by its name.
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

  it("keeps a variant's own photo links when it has them", () => {
    const withOwn = product("own", "Own", "Red", 1000, { imageIds: ["own-1", "own-2"] });
    withOwn.variants[0] = { ...withOwn.variants[0]!, images: [{ imageId: "own-2", sortOrder: 0 }] };
    const merged = mergeLandingProducts(navy, [withOwn]);
    expect(merged.variants.find((v) => v.id === "own-M")!.images).toEqual([{ imageId: "own-2", sortOrder: 0 }]);
  });
});
