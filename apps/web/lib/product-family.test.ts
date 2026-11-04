import { describe, expect, it } from "vitest";
import type { PublicProductFamily } from "@clothing-brand/shared";
import { familyTiles } from "./product-family";

const member = (id: string, over: Partial<PublicProductFamily["members"][number]> = {}): PublicProductFamily["members"][number] => ({
  productId: id,
  slug: `cap-${id}`,
  label: `Cap ${id}`,
  imageUrl: `/uploads/products/${id}-full.webp`,
  imageAlt: null,
  price: 999,
  available: true,
  ...over,
});
const family = (members: PublicProductFamily["members"]): PublicProductFamily => ({ id: "f1", name: "Choose a design", members });

describe("familyTiles", () => {
  it("marks the product being viewed as chosen and links every other one to its own page", () => {
    const tiles = familyTiles(family([member("a"), member("b"), member("c")]), "b")!;
    expect(tiles.map((t) => [t.productId, t.current, t.href])).toEqual([
      ["a", false, "/product/cap-a"],
      ["b", true, null],
      ["c", false, "/product/cap-c"],
    ]);
  });

  it("keeps a sold-out member as a link, flagged unavailable", () => {
    const tiles = familyTiles(family([member("a"), member("b", { available: false })]), "a")!;
    expect(tiles[1]).toMatchObject({ unavailable: true, href: "/product/cap-b" });
  });

  it("keeps a member without a photo (the tile shows its name instead)", () => {
    const tiles = familyTiles(family([member("a"), member("b", { imageUrl: null })]), "a")!;
    expect(tiles[1]!.imageUrl).toBeNull();
    expect(tiles[1]!.label).toBe("Cap b");
  });

  it("draws nothing when there is nothing to choose", () => {
    expect(familyTiles(family([member("a")]), "a")).toBeNull();
    expect(familyTiles(family([member("a"), member("b")]), "z")).toBeNull();
  });
});
