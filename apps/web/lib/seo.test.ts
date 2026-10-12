import { describe, expect, it } from "vitest";
import { privatePageMetadata, storeTitle } from "./seo";

describe("storeTitle", () => {
  it("lets the layout template add the store name to a plain title", () => {
    expect(storeTitle("Royal Amber", "Asif Zone")).toBe("Royal Amber");
  });

  it("uses a title that already names the store as-is, so the name isn't repeated", () => {
    expect(storeTitle("Royal Amber Perfume | Asif Zone", "Asif Zone")).toEqual({ absolute: "Royal Amber Perfume | Asif Zone" });
    expect(storeTitle("Shop at ASIF ZONE", "Asif Zone")).toEqual({ absolute: "Shop at ASIF ZONE" });
  });

  it("ignores an empty store name", () => {
    expect(storeTitle("Royal Amber", "")).toBe("Royal Amber");
  });
});

describe("privatePageMetadata", () => {
  it("titles the page and keeps it out of search results without a canonical", () => {
    const metadata = privatePageMetadata("Checkout");
    expect(metadata.title).toBe("Checkout");
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates).toBeUndefined();
  });
});
