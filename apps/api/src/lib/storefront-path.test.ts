import { describe, it, expect } from "vitest";
import { isStorefrontPath, trackPageViewSchema } from "@clothing-brand/shared";

// Admin pages and draft previews are staff, not shoppers — they must never become pageviews (sessions feed D25 conversion).
describe("isStorefrontPath", () => {
  it("accepts shopper pages", () => {
    for (const p of ["/", "/products/linen-shirt", "/category/men?sort=new", "/administrator-picks", "/previewed"]) expect(isStorefrontPath(p), p).toBe(true);
  });

  it("refuses admin pages and draft previews", () => {
    for (const p of ["/admin", "/admin/dashboard", "/admin/product-preview-frame", "/admin?x=1", "/preview/abc", "/preview"]) expect(isStorefrontPath(p), p).toBe(false);
  });

  it("the pageview beacon schema refuses an admin path", () => {
    expect(trackPageViewSchema.safeParse({ sessionId: "s1", path: "/admin/orders" }).success).toBe(false);
    expect(trackPageViewSchema.safeParse({ sessionId: "s1", path: "/products/x" }).success).toBe(true);
  });
});
