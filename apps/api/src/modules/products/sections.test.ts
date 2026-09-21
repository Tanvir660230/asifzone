import { describe, expect, it } from "vitest";
import {
  SECTION_REGISTRY,
  isEmptyOverride,
  productRelationsSchema,
  resolveSections,
  sectionLayerSchema,
  toVideoEmbed,
} from "@clothing-brand/shared";

const keys = (rs: { key: string }[]) => rs.map((r) => r.key);

describe("resolveSections", () => {
  it("with no overrides reproduces the page as it was: same accordion order, titles and shipping text", () => {
    const all = resolveSections({});
    const accordion = all.filter((s) => s.area === "accordion" && s.enabled);
    expect(keys(accordion)).toEqual(["description", "specifications", "material", "care", "shipping", "faq"]);
    expect(accordion.find((s) => s.key === "shipping")).toMatchObject({
      title: "Shipping & Returns",
      content: "Dispatched within 1–2 business days. Inside Dhaka: 1–2 days, outside Dhaka: 3–5 days. Unworn items with tags can be returned or exchanged within 7 days of delivery.",
    });
    // The page-level blocks keep their old order and titles too.
    const blocks = all.filter((s) => s.area === "block" && s.enabled);
    expect(blocks.map((b) => [b.key, b.title])).toEqual([
      ["reviews", "Reviews"], ["bundle", "Complete the Bundle"], ["related", "Best Match"], ["frequentlyBought", "Customers Also Bought"],
      ["crossSell", "Complete The Look"], ["upsell", "Upgrade Option"], ["budget", "Budget Alternative"], ["premium", "More Premium Options"],
      ["recommended", "Trending Now"], ["recentlyViewed", "Recently Viewed"],
    ]);
    expect(all.every((s) => s.source.enabled === "default" && s.source.order === "default")).toBe(true);
  });

  it("prefers product over template over global over default, per field", () => {
    const r = resolveSections({
      global: { care: { title: "Global care", enabled: false, content: null } },
      template: { care: { title: "Template care", enabled: true } },
      product: { care: { title: "Product care" } },
    }).find((s) => s.key === "care")!;
    expect(r.title).toBe("Product care");
    expect(r.source.title).toBe("product");
    expect(r.enabled).toBe(true); // template's on beats global's off
    expect(r.source.enabled).toBe("template");
  });

  it("inherits the fields a layer leaves blank instead of blanking them", () => {
    const r = resolveSections({
      global: { shipping: { content: "Free shipping over ৳3000." } },
      template: { shipping: { title: "Delivery", content: "   " } }, // blank content = inherit, not "empty text"
    }).find((s) => s.key === "shipping")!;
    expect(r).toMatchObject({ title: "Delivery", content: "Free shipping over ৳3000." });
    expect(r.source).toMatchObject({ title: "template", content: "global" });
  });

  it("orders by the chosen sort order, with defaults leaving room in between", () => {
    const accordion = (layers: Parameters<typeof resolveSections>[0]) => keys(resolveSections(layers).filter((s) => s.area === "accordion" && s.enabled));
    // FAQ moved to the very top; Shipping tucked between Description (10) and Specifications (30).
    expect(accordion({ global: { faq: { sortOrder: 5 } } })).toEqual(["faq", "description", "specifications", "material", "care", "shipping"]);
    expect(accordion({ product: { shipping: { sortOrder: 15 } } })).toEqual(["description", "shipping", "specifications", "material", "care", "faq"]);
  });

  it("lets a level switch a default-off section on, and a default-on one off", () => {
    const r = resolveSections({ global: { warranty: { enabled: true, content: "2 years." } }, product: { faq: { enabled: false } } });
    expect(r.find((s) => s.key === "warranty")).toMatchObject({ enabled: true, content: "2 years." });
    expect(r.find((s) => s.key === "faq")!.enabled).toBe(false);
  });

  it("covers every registry entry exactly once", () => {
    expect(new Set(keys(resolveSections({}))).size).toBe(SECTION_REGISTRY.length);
  });
});

describe("toVideoEmbed", () => {
  it("accepts YouTube and Vimeo links and rewrites them to their privacy-friendly embed URLs", () => {
    expect(toVideoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ kind: "iframe", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(toVideoEmbed("https://youtu.be/dQw4w9WgXcQ?t=10")).toEqual({ kind: "iframe", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(toVideoEmbed("https://vimeo.com/123456789")).toEqual({ kind: "iframe", src: "https://player.vimeo.com/video/123456789" });
  });

  it("accepts a direct https video file", () => {
    expect(toVideoEmbed("https://cdn.example.com/a/b.mp4")).toEqual({ kind: "file", src: "https://cdn.example.com/a/b.mp4" });
  });

  it("refuses everything else — other hosts, http, scripts, look-alike hosts", () => {
    for (const bad of [
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://evil.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)",
      "https://example.com/page.html",
      'https://cdn.example.com/a.mp4"onload="x',
      "",
    ]) {
      expect(toVideoEmbed(bad), bad).toBeNull();
    }
  });
});

describe("section layer validation", () => {
  it("accepts a partial override and rejects unknown keys, duplicates and misplaced content", () => {
    expect(sectionLayerSchema.safeParse([{ sectionKey: "care", title: "Looking after it" }]).success).toBe(true);
    expect(sectionLayerSchema.safeParse([{ sectionKey: "nope", enabled: true }]).success).toBe(false);
    expect(sectionLayerSchema.safeParse([{ sectionKey: "care", enabled: true }, { sectionKey: "care", enabled: false }]).success).toBe(false);
    expect(sectionLayerSchema.safeParse([{ sectionKey: "care", content: "text on a section with no text of its own" }]).success).toBe(false);
  });

  it("checks video links and list length", () => {
    expect(sectionLayerSchema.safeParse([{ sectionKey: "video", content: "https://youtu.be/dQw4w9WgXcQ" }]).success).toBe(true);
    expect(sectionLayerSchema.safeParse([{ sectionKey: "video", content: "https://evil.com/x" }]).success).toBe(false);
    expect(sectionLayerSchema.safeParse([{ sectionKey: "highlights", content: Array.from({ length: 21 }, (_, i) => `line ${i}`).join("\n") }]).success).toBe(false);
  });

  it("treats an all-blank override as no override", () => {
    expect(isEmptyOverride({ enabled: null, sortOrder: undefined, title: "  ", content: "" })).toBe(true);
    expect(isEmptyOverride({ enabled: false })).toBe(false);
  });
});

describe("curated list validation", () => {
  it("allows up to 12 unique products per kind and each kind once", () => {
    expect(productRelationsSchema.safeParse([{ kind: "RELATED", productIds: ["a", "b"] }, { kind: "UPSELL", productIds: [] }]).success).toBe(true);
    expect(productRelationsSchema.safeParse([{ kind: "RELATED", productIds: ["a", "a"] }]).success).toBe(false);
    expect(productRelationsSchema.safeParse([{ kind: "RELATED", productIds: Array.from({ length: 13 }, (_, i) => `p${i}`) }]).success).toBe(false);
    expect(productRelationsSchema.safeParse([{ kind: "RELATED", productIds: [] }, { kind: "RELATED", productIds: [] }]).success).toBe(false);
    expect(productRelationsSchema.safeParse([{ kind: "BOGUS", productIds: [] }]).success).toBe(false);
  });
});
