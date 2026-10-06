import { describe, expect, it } from "vitest";
import {
  brandStoryConfigSchema,
  createBannerSchema,
  createCategorySchema,
  mediaReference,
  mediaStorageKey,
  mediaUrlSchema,
  normalizeMediaReferences,
  resolveMediaUrl,
  updateSettingsSchema,
} from "@clothing-brand/shared";

// Phase 1B: one stored reference, one resolver, any installation's media base.

describe("media references", () => {
  it("resolves the same storage key against different installation bases", () => {
    const ref = mediaReference("products/abc-full.webp");
    expect(ref).toBe("/uploads/products/abc-full.webp");
    expect(resolveMediaUrl(ref, "/uploads")).toBe("/uploads/products/abc-full.webp");
    expect(resolveMediaUrl(ref, "https://asif.example/uploads")).toBe("https://asif.example/uploads/products/abc-full.webp");
    expect(resolveMediaUrl(ref, "https://cdn.client-b.example/media/")).toBe("https://cdn.client-b.example/media/products/abc-full.webp");
  });

  it("reads every stored form as the same storage key", () => {
    for (const stored of [
      "products/abc-full.webp",
      "/uploads/products/abc-full.webp",
      "https://asifzone.com/uploads/products/abc-full.webp",
      "http://localhost:4000/uploads/products/abc-full.webp",
      "https://203.0.113.7/uploads/products/abc-full.webp?v=2",
    ]) {
      expect(mediaStorageKey(stored)).toBe("products/abc-full.webp");
      expect(resolveMediaUrl(stored, "/uploads")).toBe("/uploads/products/abc-full.webp");
    }
  });

  it("leaves external URLs, previews and empties alone", () => {
    for (const value of ["https://images.example.com/a.jpg", "blob:http://localhost/123", "data:image/png;base64,AAAA", "/brand/logo.svg"]) {
      expect(mediaStorageKey(value)).toBeNull();
      expect(resolveMediaUrl(value, "https://cdn.example/uploads")).toBe(value);
    }
    expect(resolveMediaUrl(null, "/uploads")).toBeNull();
    expect(resolveMediaUrl(undefined, "/uploads")).toBeNull();
  });

  it("normalizes only the listed hosts, inside plain text, HTML and JSON", () => {
    const hosts = ["asifzone.com", "www.asifzone.com", "localhost:4000"];
    expect(normalizeMediaReferences("https://asifzone.com/uploads/a.webp", hosts)).toBe("/uploads/a.webp");
    expect(normalizeMediaReferences('<img src="http://www.asifzone.com/uploads/e/b.webp">', hosts)).toBe('<img src="/uploads/e/b.webp">');
    expect(normalizeMediaReferences('{"imageUrl":"http://localhost:4000/uploads/h/c.webp"}', hosts)).toBe('{"imageUrl":"/uploads/h/c.webp"}');
    // Not ours: another host, or a non-upload path on our host.
    expect(normalizeMediaReferences("https://other.example/uploads/a.webp", hosts)).toBe("https://other.example/uploads/a.webp");
    expect(normalizeMediaReferences("https://asifzone.com/category/shoes", hosts)).toBe("https://asifzone.com/category/shoes");
    // A host name that merely starts like ours is not ours.
    expect(normalizeMediaReferences("https://asifzone.com.evil.example/uploads/a.webp", hosts)).toBe("https://asifzone.com.evil.example/uploads/a.webp");
  });
});

describe("media fields accept what an upload returns", () => {
  const uploaded = mediaReference("products/abc-full.webp");

  it("accepts the stored /uploads reference and absolute URLs on every image field", () => {
    expect(updateSettingsSchema.safeParse({ logoUrl: uploaded, faviconUrl: uploaded }).success).toBe(true);
    expect(createCategorySchema.safeParse({ name: "Attar", slug: "attar", imageUrl: uploaded }).success).toBe(true);
    expect(brandStoryConfigSchema.safeParse({ imageUrl: uploaded }).success).toBe(true);
    expect(createBannerSchema.safeParse({ imageUrl: "https://cdn.example.com/banner.webp" }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ logoUrl: "" }).success).toBe(true);
  });

  it("rejects anything that is neither", () => {
    for (const value of ["/uploads/", "/uploads/../secrets", "/uploads/a/./b", "products/x.webp", "/other/x.png", "javascript:alert(1)", "https://x.example/a b"]) {
      expect(mediaUrlSchema.safeParse(value).success, value).toBe(false);
    }
  });
});
