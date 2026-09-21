import { describe, expect, it } from "vitest";
import { abbreviateForSku, defaultTypeCode, pickGalleryImages, renderSkuPattern, validateSkuPattern } from "@clothing-brand/shared";

describe("SKU patterns", () => {
  const ctx = { prefix: "AZ", typeCode: "PNJ", color: "Black", size: "M", seq: 1 };

  it("renders the documented example shapes", () => {
    expect(renderSkuPattern("{PREFIX}-{TYPE}-{COLOR}-{SIZE}-{SEQ:3}", ctx)).toBe("AZ-PNJ-BLA-M-001");
    expect(renderSkuPattern("{PREFIX}-{TYPE}-{COLOR}-{SIZE}-{SEQ:3}", { ...ctx, typeCode: "SHO", color: "Brown", size: "42", seq: 3 })).toBe("AZ-SHO-BRO-42-003");
    expect(renderSkuPattern("{TYPE}{SEQ:5}", { ...ctx, seq: 42 })).toBe("PNJ00042");
  });

  it("collapses the separators around a missing part instead of leaving 'AZ-PNJ--M-001'", () => {
    expect(renderSkuPattern("{PREFIX}-{TYPE}-{COLOR}-{SIZE}-{SEQ:3}", { ...ctx, color: "" })).toBe("AZ-PNJ-M-001");
    expect(renderSkuPattern("{PREFIX}-{TYPE}-{COLOR}-{SIZE}-{SEQ:3}", { ...ctx, color: null, size: null })).toBe("AZ-PNJ-001");
  });

  it("makes user-typed colour and size safe for a label or URL", () => {
    expect(renderSkuPattern("{COLOR}-{SIZE}-{SEQ}", { ...ctx, color: "Off White!", size: "50 ml" })).toBe("OFF-50ML-1");
    expect(abbreviateForSku("  a/b  ")).toBe("AB");
    expect(defaultTypeCode("Panjabi")).toBe("PAN");
    expect(defaultTypeCode("!!")).toBe("GEN");
  });

  it("validates patterns: known tokens, safe literals, and a sequence so SKUs are unique", () => {
    expect(validateSkuPattern("{PREFIX}-{TYPE}-{COLOR}-{SIZE}-{SEQ:3}")).toBeNull();
    expect(validateSkuPattern("AZ-{SEQ}")).toBeNull();
    expect(validateSkuPattern("{PREFIX}-{TYPE}")).toMatch(/SEQ/);
    expect(validateSkuPattern("{PREFIX}-{FOO}-{SEQ}")).toMatch(/token/);
    expect(validateSkuPattern("AZ {SEQ}")).toMatch(/only letters/);
    expect(validateSkuPattern("{SEQ:9}")).toMatch(/token|SEQ/);
    expect(validateSkuPattern("x".repeat(90) + "{SEQ}")).toMatch(/too long/);
  });
});

describe("pickGalleryImages", () => {
  const img = (id: string, sortOrder: number) => ({ id, sortOrder });
  const images = [img("shared", 0), img("b1", 1), img("b2", 2), img("w1", 3), img("w2", 4)];
  const variants = [
    { size: "M", color: "Black", images: [{ imageId: "b1", sortOrder: 0 }, { imageId: "b2", sortOrder: 1 }] },
    { size: "L", color: "Black", images: [] as { imageId: string; sortOrder: number }[] },
    { size: "M", color: "White", images: [{ imageId: "w2", sortOrder: 0 }, { imageId: "w1", sortOrder: 1 }] },
    { size: "M", color: "Red", images: [] as { imageId: string; sortOrder: number }[] },
  ];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("shows everything until a colour is chosen", () => {
    expect(ids(pickGalleryImages(images, variants, {}))).toEqual(["shared", "b1", "b2", "w1", "w2"]);
  });

  it("shows the chosen colour's images in its own order, then the shared ones", () => {
    expect(ids(pickGalleryImages(images, variants, { color: "White", size: "M" }))).toEqual(["w2", "w1", "shared"]);
  });

  it("uses a sibling variant's gallery when the exact size has none of its own", () => {
    expect(ids(pickGalleryImages(images, variants, { color: "Black", size: "L" }))).toEqual(["b1", "b2", "shared"]);
    expect(ids(pickGalleryImages(images, variants, { color: "Black" }))).toEqual(["b1", "b2", "shared"]);
  });

  it("falls back to the whole gallery for a colour with no images at all", () => {
    expect(ids(pickGalleryImages(images, variants, { color: "Red", size: "M" }))).toEqual(["shared", "b1", "b2", "w1", "w2"]);
  });

  it("falls back to the legacy single imageId when a variant has no gallery rows", () => {
    const legacy = [{ size: "M", color: "Blue", imageId: "b2", images: undefined }];
    // Nothing else is assigned to a variant in this scenario, so the other images count as shared and follow it.
    expect(ids(pickGalleryImages(images, legacy, { color: "Blue", size: "M" }))).toEqual(["b2", "shared", "b1", "w1", "w2"]);
  });

  it("ignores gallery entries that point at images the product no longer has", () => {
    const stale = [{ size: "M", color: "Gone", images: [{ imageId: "deleted", sortOrder: 0 }] }];
    expect(ids(pickGalleryImages(images, stale, { color: "Gone", size: "M" }))).toEqual(["shared", "b1", "b2", "w1", "w2"]);
  });
});
