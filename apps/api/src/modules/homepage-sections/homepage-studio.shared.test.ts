import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUST_STRIP_ITEMS,
  DEFAULT_VALUES_GRID_ITEMS,
  accentForeground,
  hexToRgb,
  studioDesignChecks,
  validateStorefrontDesign,
  studioHealthChecks,
  validateStudioSections,
  type StudioSection,
} from "@clothing-brand/shared";

function section(id: string, type: StudioSection["type"], config: Record<string, unknown> = {}, extra: Partial<StudioSection> = {}): StudioSection {
  return { id, type, isActive: true, config, startsAt: null, endsAt: null, ...extra };
}

// The homepage a fresh store starts with (homepage-section.service.ts DEFAULT_SECTIONS).
const SEEDED: StudioSection[] = [
  section("seed-hero", "HERO"),
  section("seed-trust-strip", "TRUST_STRIP", { items: [...DEFAULT_TRUST_STRIP_ITEMS] }),
  section("seed-personalized-lead", "PERSONALIZED_LEAD"),
  section("seed-product-carousel", "PRODUCT_CAROUSEL", { heading: "Featured", source: "featured", itemCount: 8 }),
  section("seed-flash-sale", "FLASH_SALE"),
  section("seed-category-grid", "CATEGORY_GRID"),
  section("seed-brand-story", "BRAND_STORY"),
  section("seed-values-grid", "VALUES_GRID", { items: [...DEFAULT_VALUES_GRID_ITEMS] }),
  section("seed-smart-recommendations", "SMART_RECOMMENDATIONS"),
];

describe("validateStudioSections", () => {
  it("accepts the seeded homepage", () => {
    expect(validateStudioSections(SEEDED)).toEqual({});
  });

  it("flags a second singleton and an invalid config by section id", () => {
    const errors = validateStudioSections([
      ...SEEDED,
      section("new-hero", "HERO"),
      section("new-carousel", "PRODUCT_CAROUSEL", { heading: "", source: "featured", itemCount: 8 }),
    ]);
    expect(Object.keys(errors).sort()).toEqual(["new-carousel", "new-hero"]);
    expect(errors["new-hero"]![0]).toMatch(/only one/i);
  });

  it("accepts new section types with appearance and rejects unknown appearance values", () => {
    const ok = validateStudioSections([
      ...SEEDED,
      section("new-text", "RICH_TEXT", { heading: "Made in Dhaka", appearance: { spacing: "compact", background: "muted" } }),
      section("new-story", "BRAND_STORY", { heading: "Second story", appearance: { tone: "light", layout: "image-left" } }),
    ]);
    expect(ok).toEqual({});
    const bad = validateStudioSections([...SEEDED.slice(0, 6), section("seed-brand-story", "BRAND_STORY", { appearance: { tone: "neon" } }), ...SEEDED.slice(7)]);
    expect(Object.keys(bad)).toEqual(["seed-brand-story"]);
  });

  it("flags a schedule that ends before it starts", () => {
    const errors = validateStudioSections([
      ...SEEDED,
      section("new-promo", "PROMO_BANNER", { heading: "Eid" }, { startsAt: "2026-10-20T00:00:00.000Z", endsAt: "2026-10-10T00:00:00.000Z" }),
    ]);
    expect(errors["new-promo"]![0]).toMatch(/ends before it starts/i);
  });
});

describe("studioHealthChecks", () => {
  const now = new Date("2026-10-12T12:00:00.000Z");
  const codes = (sections: StudioSection[]) => studioHealthChecks(sections, now).map((c) => `${c.sectionId}:${c.code}`);

  it("finds nothing wrong with the seeded homepage", () => {
    expect(studioHealthChecks(SEEDED, now).filter((c) => c.level !== "tip")).toEqual([]);
  });

  it("warns about two dark bands in a row", () => {
    const sections = [...SEEDED, section("new-promo", "PROMO_BANNER", { heading: "Eid sale" })];
    // brand story (dark) is followed by values grid in SEEDED; move the promo right after it.
    const story = sections.findIndex((s) => s.type === "BRAND_STORY");
    sections.splice(story + 1, 0, sections.pop()!);
    expect(codes(sections)).toContain("new-promo:dark-bands-adjacent");
  });

  it("does not count a light-toned band as dark", () => {
    const sections = SEEDED.map((s) => (s.type === "BRAND_STORY" ? { ...s, config: { appearance: { tone: "light" } } } : s));
    const story = sections.findIndex((s) => s.type === "BRAND_STORY");
    sections.splice(story + 1, 0, section("new-promo", "PROMO_BANNER", { heading: "Eid sale" }));
    expect(codes(sections)).not.toContain("new-promo:dark-bands-adjacent");
  });

  it("warns about an expired schedule, a half-filled button and invalid sections", () => {
    const sections = [
      ...SEEDED,
      section("new-old", "PROMO_BANNER", { heading: "Puja" }, { endsAt: "2026-10-01T00:00:00.000Z" }),
      section("new-text", "RICH_TEXT", { heading: "Hello", ctaLabel: "Shop now" }),
      section("new-carousel", "PRODUCT_CAROUSEL", { heading: "", source: "featured", itemCount: 8 }),
    ];
    const found = codes(sections);
    expect(found).toContain("new-old:schedule-expired");
    expect(found).toContain("new-text:cta-incomplete");
    expect(found).toContain("new-carousel:invalid");
    expect(studioHealthChecks(sections, now).find((c) => c.code === "invalid")!.level).toBe("error");
  });

  it("ignores switched-off sections for layout checks", () => {
    const sections = [...SEEDED, section("new-old", "PROMO_BANNER", { heading: "Puja" }, { isActive: false, endsAt: "2026-10-01T00:00:00.000Z" })];
    expect(codes(sections)).not.toContain("new-old:schedule-expired");
  });
});

describe("site design", () => {
  it("accepts an empty design and a full one, and rejects bad colours and half-filled links", () => {
    expect(validateStorefrontDesign({}).groups).toEqual({});
    const full = {
      theme: { accent: "#1f3a5f", headingFont: "editorial", bodyFont: "grotesk", corners: "soft", rhythm: "airy", bands: "light" },
      announcement: { enabled: true, tone: "accent", messages: [{ text: "Free delivery in Dhaka", href: "/shipping-returns" }] },
      header: { menuLinks: [{ label: "Sale", href: "/search?sort=newest" }] },
      footer: { about: "Made in Dhaka", showNewsletter: false, linksTitle: "Explore", links: [{ label: "Lookbook", href: "/lookbook" }] },
    };
    expect(validateStorefrontDesign(full).groups).toEqual({});
    const bad = validateStorefrontDesign({ theme: { accent: "navy" }, header: { menuLinks: [{ label: "Sale", href: "" }] } });
    expect(Object.keys(bad.groups).sort()).toEqual(["header", "theme"]);
    expect(bad.fields["header.menuLinks.0.href"]).toMatch(/link/i);
  });

  it("only accepts store pages, web addresses, email and phone as menu links", () => {
    const link = (href: string) => validateStorefrontDesign({ header: { menuLinks: [{ label: "Sale", href }] } }).groups.header;
    for (const ok of ["/sale", "/category/panjabi?sort=new", "https://example.com/lookbook", "mailto:hi@store.com", "tel:01700000000"]) expect(link(ok), ok).toBeUndefined();
    for (const bad of ["javascript:alert(1)", "//evil.example", "sale", "data:text/html,hi"]) expect(link(bad), bad).toBeDefined();
  });

  it("refuses an announcement bar that is on with nothing to say", () => {
    expect(validateStorefrontDesign({ announcement: { enabled: true, messages: [] } }).groups.announcement).toBeDefined();
    expect(validateStorefrontDesign({ announcement: { enabled: false, messages: [] } }).groups).toEqual({});
  });

  it("puts white text on a deep accent and dark text on a pale one", () => {
    expect(accentForeground(hexToRgb("#1f3a5f"))).toEqual([255, 255, 255]);
    expect(accentForeground(hexToRgb("#f5d76e"))).toEqual([17, 17, 17]);
  });

  it("warns about a pale brand colour and blocks an invalid design", () => {
    const pale = studioDesignChecks({ theme: { accent: "#f5d76e" } });
    expect(pale.map((c) => `${c.sectionId}:${c.code}`)).toContain("design:theme:accent-low-contrast");
    const broken = studioDesignChecks({ announcement: { enabled: true, messages: [] } });
    expect(broken.find((c) => c.code === "invalid")).toMatchObject({ sectionId: "design:announcement", level: "error" });
    expect(studioDesignChecks({ theme: { accent: "#1f3a5f" } })).toEqual([]);
  });
});
