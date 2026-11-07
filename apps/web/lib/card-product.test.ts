import { describe, expect, it } from "vitest";
import type { Product } from "@clothing-brand/shared";
import { cardProduct, cardProducts } from "./card-product";

const long = "Hand-poured attar. ".repeat(30);
const product = {
  id: "p1",
  name: "Royal Amber",
  slug: "royal-amber",
  description: `<p>${long}</p>`,
  shortDescription: long.slice(0, 200),
  seoTitle: "Royal Amber attar | The store",
  seoDescription: long.slice(0, 160),
  basePrice: "599",
  compareAtPrice: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  images: [{ url: "/uploads/p1.webp" }],
  category: {
    id: "c1", name: "Men's Fragrance", slug: "mens-fragrance", parentId: null, imageUrl: "/uploads/cat.webp", imageAltText: "x",
    wideImageUrl: null, bannerImageUrl: "/uploads/banner.webp", sortOrder: 1, isActive: true, isFeatured: true,
    seoTitle: "Men's fragrance", seoDescription: long, deletedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-02",
  },
  variants: [{ id: "v1", productId: "p1", sku: "ROY-002", size: "6ml", color: null, colorHex: null, price: "599", stock: 9, barcode: "123", createdAt: "2026-10-01", updatedAt: "2026-11-01" }],
} as unknown as Product;

describe("cardProduct", () => {
  it("drops what a card never shows and keeps what it does", () => {
    const c = cardProduct(product);
    expect(c).toMatchObject({ id: "p1", name: "Royal Amber", slug: "royal-amber", basePrice: "599", createdAt: product.createdAt, images: product.images });
    expect(c.description).toBe("");
    expect([c.shortDescription, c.seoTitle, c.seoDescription]).toEqual([null, null, null]);
    expect(c.category).toMatchObject({ id: "c1", name: "Men's Fragrance", slug: "mens-fragrance", seoDescription: null, bannerImageUrl: null });
    expect(c.variants[0]).toMatchObject({ id: "v1", sku: "ROY-002", size: "6ml", price: "599", stock: 9, barcode: null });
  });

  it("is much smaller, and a listing result keeps its other fields", () => {
    expect(JSON.stringify(cardProduct(product)).length).toBeLessThan(JSON.stringify(product).length * 0.5);
    const result = cardProducts({ items: [product], total: 1, page: 1 });
    expect(result).toMatchObject({ total: 1, page: 1 });
    expect(result.items[0]!.description).toBe("");
  });
});
