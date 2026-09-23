import { describe, expect, it } from "vitest";
import { computeCompleteness, describeBlockers, type CompletenessInput, type ResolvedAttributeField } from "@clothing-brand/shared";
import { diffProduct, type AuditSnapshot } from "./product-audit";

const field = (key: string, required: boolean): ResolvedAttributeField => ({
  definitionId: key, key, label: key.toUpperCase(), dataType: "TEXT", unit: null, placeholder: null, helpText: null,
  required, options: [], specGroupId: null, specGroupName: null, showOnStorefront: true,
});
const config = (over: Partial<{ fields: ResolvedAttributeField[]; requiredChecks: string[]; dims: ("size" | "color")[] }> = {}) => ({
  fields: over.fields ?? [],
  requiredChecks: over.requiredChecks ?? [],
  variantDimensions: (over.dims ?? []).map((d) => ({ targetField: d, label: d, options: [] })),
});
const complete = (over: Partial<CompletenessInput> = {}): CompletenessInput => ({
  name: "Panjabi", categoryId: "c1", basePrice: 100, description: "<p>Nice</p>", seoDescription: "Meta", trackInventory: true,
  variants: [{ sku: "A", size: "M", color: "Black", stock: 3 }], imageCount: 2, attributes: { material: "Cotton" },
  materialCount: 1, hasCare: true, sizeGuideShown: true, ...over,
});

describe("computeCompleteness", () => {
  it("scores a fully filled product 100 with no blockers", () => {
    const r = computeCompleteness(complete(), config({ dims: ["size", "color"] }));
    expect(r.score).toBe(100);
    expect(r.blockers).toEqual([]);
  });

  it("blocks on the always-required checks", () => {
    const r = computeCompleteness(complete({ name: " ", basePrice: 0, imageCount: 0, variants: [] }), config());
    expect(r.blockers.map((b) => b.key)).toEqual(["basics", "pricing", "variants", "images"]);
    expect(describeBlockers(r)).toBe("Basic information, Pricing, Variants, Images");
  });

  it("only warns about optional checks unless the template requires them", () => {
    const input = complete({ description: "<p> </p>", seoDescription: "", hasCare: false });
    const lenient = computeCompleteness(input, config());
    expect(lenient.blockers).toEqual([]);
    expect(lenient.checks.filter((c) => c.status === "missing").map((c) => c.key)).toEqual(["description", "seo", "care"]);
    expect(lenient.score).toBeLessThan(100);

    const strict = computeCompleteness(input, config({ requiredChecks: ["description", "care"] }));
    expect(strict.blockers.map((b) => b.key)).toEqual(["description", "care"]);
  });

  it("checks the variants' own options against the type's dimensions", () => {
    const input = complete({ variants: [{ sku: "A", size: "M", color: "", stock: 1 }, { sku: "", size: "L", color: "Red", stock: 1 }] });
    const r = computeCompleteness(input, config({ dims: ["size", "color"] }));
    expect(r.checks.find((c) => c.key === "variants")).toMatchObject({ status: "missing", detail: "2 variant(s) missing a SKU or option" });
    // The same variants are fine for a type with no colour dimension… except the blank SKU.
    expect(computeCompleteness(input, config({ dims: ["size"] })).checks.find((c) => c.key === "variants")?.detail).toBe("1 variant(s) missing a SKU or option");
  });

  it("requires the template's required attributes, by label", () => {
    const r = computeCompleteness(complete({ attributes: { fit: "Slim" } }), config({ fields: [field("fit", true), field("weave", true), field("note", false)] }));
    expect(r.checks.find((c) => c.key === "attributes")).toMatchObject({ status: "missing", required: true, detail: "Fill in: WEAVE" });
  });

  it("leaves not-applicable checks out of the score", () => {
    const withGuide = computeCompleteness(complete({ sizeGuideShown: true }), config());
    const noGuide = computeCompleteness(complete({ sizeGuideShown: null }), config());
    expect(noGuide.checks.find((c) => c.key === "sizeGuide")?.status).toBe("na");
    expect(noGuide.score).toBe(100);
    expect(withGuide.score).toBe(100);
    expect(computeCompleteness(complete({ sizeGuideShown: false }), config()).score).toBeLessThan(100);
  });

  it("treats stock tracking off as inventory-complete, and accepts a material attribute as material", () => {
    expect(computeCompleteness(complete({ trackInventory: false, variants: [{ sku: "A", size: "M", color: "B", stock: 0 }] }), config()).checks.find((c) => c.key === "inventory")?.status).toBe("ok");
    expect(computeCompleteness(complete({ materialCount: 0, attributes: { material: "Linen" } }), config()).checks.find((c) => c.key === "material")?.status).toBe("ok");
    expect(computeCompleteness(complete({ materialCount: 0, attributes: {} }), config()).checks.find((c) => c.key === "material")?.status).toBe("missing");
  });

  it("treats a disabled Material/Care section as not-applicable, out of the score, never a blocker", () => {
    const noMaterial = computeCompleteness(complete({ materialCount: 0, attributes: {}, materialEnabled: false }), config({ requiredChecks: ["material", "care"] }));
    expect(noMaterial.checks.find((c) => c.key === "material")?.status).toBe("na");
    expect(noMaterial.blockers.map((b) => b.key)).not.toContain("material");

    const noCare = computeCompleteness(complete({ hasCare: false, careEnabled: false }), config({ requiredChecks: ["material", "care"] }));
    expect(noCare.checks.find((c) => c.key === "care")?.status).toBe("na");
    expect(noCare.blockers.map((b) => b.key)).not.toContain("care");

    // Omitting the flags (existing callers) keeps today's behaviour: still scored, still missing.
    const omitted = computeCompleteness(complete({ materialCount: 0, attributes: {}, hasCare: false }), config());
    expect(omitted.checks.find((c) => c.key === "material")?.status).toBe("missing");
    expect(omitted.checks.find((c) => c.key === "care")?.status).toBe("missing");

    // A fully-complete product scores 100 whether or not the disabled sections are also absent.
    expect(computeCompleteness(complete({ materialEnabled: false, careEnabled: false, materialCount: 0, attributes: {}, hasCare: false }), config()).score).toBe(100);
  });
});

const snap = (over: Partial<AuditSnapshot> = {}): AuditSnapshot => ({
  name: "P", slug: "p", categoryId: "c", typeId: "t", brand: null, brandTier: "PREMIUM", shortDescription: null, description: "",
  basePrice: "100.00", compareAtPrice: null, costPrice: null, taxRate: null, trackInventory: true, lowStockThreshold: 5, isFeatured: false,
  sortOrder: 0, status: "DRAFT", seoTitle: null, seoDescription: null, attributes: {}, materials: [],
  variants: [{ id: "v1", sku: "S1", size: "M", color: "Black", price: null, stock: 5 }], ...over,
});

describe("diffProduct", () => {
  it("emits nothing when nothing changed (Decimal strings vs numbers don't count as a change)", () => {
    expect(diffProduct(snap(), snap({ basePrice: 100 }))).toEqual([]);
  });

  it("names publish and unpublish specifically", () => {
    expect(diffProduct(snap({ status: "READY" }), snap({ status: "PUBLISHED" }))[0]?.action).toBe("product.published");
    expect(diffProduct(snap({ status: "PUBLISHED" }), snap({ status: "DRAFT" }))[0]?.action).toBe("product.unpublished");
    expect(diffProduct(snap({ status: "DRAFT" }), snap({ status: "READY" }))[0]?.action).toBe("product.status_changed");
  });

  it("reports price changes, including a variant price override, with numeric from/to", () => {
    const events = diffProduct(snap(), snap({ basePrice: "120.50", variants: [{ id: "v1", sku: "S1", size: "M", color: "Black", price: "130", stock: 5 }] }));
    expect(events).toEqual([
      { action: "product.price_changed", changes: [{ field: "basePrice", from: 100, to: 120.5 }, { field: "variant S1 price", from: null, to: 130 }] },
    ]);
  });

  it("tracks stock per variant and treats a SKU rename as a rename, not remove+add", () => {
    const events = diffProduct(snap(), snap({ variants: [{ id: "v1", sku: "S1-NEW", size: "M", color: "Black", price: null, stock: 2 }] }));
    expect(events.map((e) => e.action).sort()).toEqual(["product.stock_changed", "product.variants_changed"]);
    expect(events.find((e) => e.action === "product.variants_changed")?.changes).toEqual([{ field: "variant SKU", from: "S1", to: "S1-NEW" }]);
  });

  it("detects added and removed variants", () => {
    const events = diffProduct(snap(), snap({ variants: [{ id: "v2", sku: "S2", size: "L", color: "Red", price: null, stock: 1 }] }));
    expect(events.find((e) => e.action === "product.variants_changed")?.changes).toEqual([
      { field: "variant added", from: null, to: "S2 (L / Red)" },
      { field: "variant removed", from: "S1", to: null },
    ]);
  });

  it("separates size guide, attributes, SEO, care and materials", () => {
    const events = diffProduct(
      snap({ attributes: { fit: "Slim" } }),
      snap({
        attributes: { fit: "Regular", sizeGuide: { enabled: true } }, seoTitle: "T", carePresetId: "care1",
        materials: [{ materialId: "m1", customName: null, percentage: 100 }],
      }),
    );
    expect(events.map((e) => e.action).sort()).toEqual([
      "product.attributes_updated", "product.care_updated", "product.materials_updated", "product.seo_updated", "product.size_guide_changed",
    ]);
    expect(events.find((e) => e.action === "product.attributes_updated")?.changes).toEqual([{ field: "fit", from: "Slim", to: "Regular" }]);
  });

  it("summarises a description change by length rather than storing the text", () => {
    const e = diffProduct(snap({ description: "abc" }), snap({ description: "abcdef" }));
    expect(e).toEqual([{ action: "product.description_updated", changes: [{ field: "description", from: "3 characters", to: "6 characters" }] }]);
  });

  it("puts everything else under details_updated", () => {
    const e = diffProduct(snap(), snap({ name: "Renamed", isFeatured: true }));
    expect(e).toEqual([{ action: "product.details_updated", changes: [{ field: "name", from: "P", to: "Renamed" }, { field: "isFeatured", from: false, to: true }] }]);
  });
});
