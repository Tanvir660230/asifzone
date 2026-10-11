import { describe, expect, it } from "vitest";
import { thumbnailUrl } from "./image-url";

describe("thumbnailUrl", () => {
  it("uses the 300px rendition of an uploaded photo", () => {
    expect(thumbnailUrl("/uploads/products/abc-full.webp")).toBe("/uploads/products/abc-thumb.webp");
    expect(thumbnailUrl("products/abc-full.webp")).toBe("/uploads/products/abc-thumb.webp");
    expect(thumbnailUrl("/uploads/products/abc-full.webp?v=2")).toBe("/uploads/products/abc-thumb.webp?v=2");
  });

  it("leaves anything without renditions alone", () => {
    expect(thumbnailUrl("/uploads/branding/logo.png")).toBe("/uploads/branding/logo.png");
    expect(thumbnailUrl("https://cdn.example/x-full.webp.jpg")).toBe("https://cdn.example/x-full.webp.jpg");
    expect(thumbnailUrl("blob:http://localhost/123")).toBe("blob:http://localhost/123");
  });
});
