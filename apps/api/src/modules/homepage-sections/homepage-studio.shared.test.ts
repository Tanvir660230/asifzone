import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUST_STRIP_ITEMS,
  DEFAULT_VALUES_GRID_ITEMS,
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
