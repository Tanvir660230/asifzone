import { describe, expect, it } from "vitest";
import { productOrderMessage, withWhatsAppMessage } from "./whatsapp";
import { rememberSize, suggestSize } from "./size-memory";
import { pickCartSuggestions } from "./cart-suggestions";

describe("pickCartSuggestions", () => {
  const p = (id: string, stock = true) => ({ id, stock });
  const inStock = (x: { stock: boolean }) => x.stock;

  it("keeps list order, skips the bag, duplicates and sold-out products", () => {
    const bundle = [p("a"), p("b", false), p("c")];
    const rail = [p("c"), p("d"), p("bag")];
    expect(pickCartSuggestions([bundle, rail], new Set(["bag"]), inStock).map((x) => x.id)).toEqual(["a", "c", "d"]);
  });

  it("stops at the limit", () => {
    expect(pickCartSuggestions([[p("a"), p("b"), p("c")]], new Set(), inStock, 2)).toHaveLength(2);
  });
});

describe("withWhatsAppMessage", () => {
  it("sets the text on wa.me and api.whatsapp.com links, replacing an existing one", () => {
    expect(withWhatsAppMessage("https://wa.me/8801700000000", "Hi there")).toBe("https://wa.me/8801700000000?text=Hi+there");
    expect(withWhatsAppMessage("https://api.whatsapp.com/send?phone=880170&text=old", "new")).toBe("https://api.whatsapp.com/send?phone=880170&text=new");
  });

  it("leaves the link alone without a message or when it is not a URL", () => {
    expect(withWhatsAppMessage("https://wa.me/1", null)).toBe("https://wa.me/1");
    expect(withWhatsAppMessage("not a url", "x")).toBe("not a url");
  });
});

describe("productOrderMessage", () => {
  it("lists the product, the chosen options, the quantity and the link", () => {
    expect(
      productOrderMessage({
        productName: "Cotton Cap",
        options: [
          { label: "Size", value: "22" },
          { label: "Colour", value: "White" },
        ],
        quantity: 2,
        url: "https://shop.test/product/cotton-cap",
      }),
    ).toBe("Hi, I'd like to order:\nCotton Cap\nSize: 22\nColour: White\nQuantity: 2\nhttps://shop.test/product/cotton-cap");
  });

  it("never sends a quantity below one", () => {
    expect(productOrderMessage({ productName: "A", options: [], quantity: 0, url: "u" })).toContain("Quantity: 1");
  });
});

describe("size memory", () => {
  it("keeps the most recent size first without duplicates", () => {
    expect(rememberSize(["M", "L", "22"], "L")).toEqual(["L", "M", "22"]);
    expect(rememberSize(["M"], "  ")).toEqual(["M"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => String(i));
    expect(rememberSize(many, "x")).toHaveLength(12);
  });

  it("suggests the most recent size the product offers and has in stock", () => {
    const inStock = (s: string) => s !== "L";
    expect(suggestSize(["XL", "L", "M"], ["S", "M", "L"], inStock)).toBe("M");
    expect(suggestSize(["XL"], ["S", "M"], inStock)).toBeNull();
  });
});
