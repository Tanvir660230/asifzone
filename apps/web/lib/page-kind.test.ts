import { describe, it, expect } from "vitest";
import { pageKindFromPath } from "./page-kind";

describe("pageKindFromPath", () => {
  it("maps storefront routes to the page kinds Site speed reports on", () => {
    expect(pageKindFromPath("/")).toBe("home");
    expect(pageKindFromPath("/product/black-cotton-panjabi")).toBe("product");
    expect(pageKindFromPath("/category/panjabi")).toBe("category");
    expect(pageKindFromPath("/search")).toBe("search");
    expect(pageKindFromPath("/cart")).toBe("cart");
    expect(pageKindFromPath("/checkout")).toBe("checkout");
    expect(pageKindFromPath("/pay/abc123")).toBe("checkout");
    expect(pageKindFromPath("/lp/eid-offer")).toBe("landing");
    expect(pageKindFromPath("/account/orders")).toBe("account");
    expect(pageKindFromPath("/about")).toBe("other");
    expect(pageKindFromPath("/product")).toBe("other");
  });

  it("returns null where speed is not measured", () => {
    expect(pageKindFromPath("/admin/dashboard")).toBeNull();
    expect(pageKindFromPath("/admin")).toBeNull();
    expect(pageKindFromPath("/preview/abc")).toBeNull();
  });
});
