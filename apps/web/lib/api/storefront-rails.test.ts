import { afterEach, describe, expect, it, vi } from "vitest";
import { getBundleForProduct, getProductRail, getSimilarProducts, getTrendingProducts } from "./storefront";

// The product page's recommendation rows (and the cart's suggestions) only ever render listing cards, so they get the
// same card-sized products as the home page and category listings — the long texts never travel to the phone.
const full = {
  id: "p2",
  name: "Black Cap",
  slug: "black-cap",
  description: "<p>" + "Long text. ".repeat(80) + "</p>",
  shortDescription: "Short text",
  seoTitle: "Black Cap",
  seoDescription: "SEO",
  images: [{ url: "/uploads/p2.webp" }],
  category: null,
  variants: [{ id: "v2", sku: "CAP-1", price: "450", stock: 4, barcode: "999", createdAt: "2026-10-01", updatedAt: "2026-11-01" }],
};

function answer(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

afterEach(() => vi.unstubAllGlobals());

describe("recommendation rails send card-sized products", () => {
  it("similar, trending and hand-picked rails drop the long texts but keep what a card needs", async () => {
    answer({ items: [full] });
    for (const load of [() => getSimilarProducts("p1"), () => getTrendingProducts(), () => getProductRail("p1", "related")]) {
      const [p] = (await load()).items;
      expect(p!.description).toBe("");
      expect(p!.seoTitle).toBeNull();
      expect(p!.variants![0]!.barcode).toBeNull();
      expect(p!.variants![0]!.price).toBe("450");
      expect(p!.images[0]!.url).toBe("/uploads/p2.webp");
    }
  });

  it("a rail keeps whether it was hand-picked", async () => {
    answer({ source: "curated", items: [full] });
    expect((await getProductRail("p1", "related")).source).toBe("curated");
  });

  it("the bundle's suggested products are slimmed too, and no bundle stays no bundle", async () => {
    answer({ result: { bundle: { id: "b1" }, suggestedProducts: [full] } });
    expect((await getBundleForProduct("p1")).result!.suggestedProducts[0]!.description).toBe("");
    answer({ result: null });
    expect((await getBundleForProduct("p1")).result).toBeNull();
  });
});
