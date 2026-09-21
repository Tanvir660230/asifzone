import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIZE_GUIDE,
  LEGACY_PRODUCT_TYPE_KEYS,
  NO_SIZE_VALUE,
  PRODUCT_TYPE_CONFIGS,
  PRODUCT_TYPE_KEYS,
  createProductSchema,
  formatVariantLabel,
  formatVariantSuffix,
  getDefaultSizeGuide,
  getProductTypeConfig,
  updateProductSchema,
  validateProductAgainstConfig,
  type AttributeDataType,
  type LegacyProductType,
} from "@clothing-brand/shared";

// Any valid cuid — the schema only checks the shape.
const CUID = "ckabcdefghijklmnopqrstuvw";

/** The old hard-coded type config, reshaped like a database-resolved one — proves the data-driven
 * validator accepts and rejects exactly what the per-type zod refine used to. */
function configFor(type: LegacyProductType) {
  const c = PRODUCT_TYPE_CONFIGS[type];
  return {
    variantDimensions: c.variantDimensions.map((d) => ({ targetField: d.targetField, label: d.label, options: d.options ?? [] })),
    sizeGuide: {
      mode: !c.sizeGuide?.supported ? ("NOT_APPLICABLE" as const) : c.sizeGuide.defaultEnabled ? ("ON_BY_DEFAULT" as const) : ("OFF_BY_DEFAULT" as const),
      presetId: null,
      chart: null,
    },
    fields: c.fields.map((f) => ({
      definitionId: f.key, key: f.key, label: f.label, dataType: f.type as AttributeDataType, unit: null,
      placeholder: null, helpText: null, required: Boolean(f.required), options: f.options ?? [], specGroupId: null,
      specGroupName: null, showOnStorefront: true,
    })),
  };
}

describe("product type registry", () => {
  it("matches the Prisma ProductType enum exactly", () => {
    // A DB enum can't be generated from TS, so this is the guard against the two drifting apart:
    // adding an enum value means updating the list and a migration, and forgetting one half fails here.
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const block = /enum ProductType \{([^}]*)\}/.exec(schema)?.[1] ?? "";
    const prismaValues = block.replace(/\/\/\/.*$/gm, "").split(/\s+/).filter(Boolean);
    expect([...prismaValues].sort()).toEqual([...PRODUCT_TYPE_KEYS].sort());
  });

  it("has one legacy config per legacy type, keyed by its own type", () => {
    expect(Object.keys(PRODUCT_TYPE_CONFIGS).sort()).toEqual([...LEGACY_PRODUCT_TYPE_KEYS].sort());
    for (const key of LEGACY_PRODUCT_TYPE_KEYS) expect(PRODUCT_TYPE_CONFIGS[key].type).toBe(key);
  });

  it("falls back to Clothing for an unknown type instead of throwing", () => {
    expect(getProductTypeConfig("TOYS").type).toBe("CLOTHING");
  });
});

describe("validateProductAgainstConfig (per-type variant rules)", () => {
  const issuePaths = (type: LegacyProductType, variant: Record<string, unknown>) =>
    validateProductAgainstConfig({ variants: [variant] }, configFor(type)).map((i) => i.path.join("."));

  it("requires size and colour for Clothing", () => {
    expect(issuePaths("CLOTHING", {})).toEqual(["variants.0.size", "variants.0.color"]);
  });

  it("needs only a colour for Accessory", () => {
    expect(issuePaths("ACCESSORY", { color: "Tan" })).toEqual([]);
    expect(issuePaths("ACCESSORY", {})).toEqual(["variants.0.color"]);
  });

  it("needs only a volume for Fragrance", () => {
    expect(issuePaths("FRAGRANCE", { size: "12ml" })).toEqual([]);
  });

  it("names the type's own dimension in the error", () => {
    const [issue] = validateProductAgainstConfig({ variants: [{}] }, configFor("ISLAMIC_PRODUCT"));
    expect(issue?.message).toBe("Edition / Type is required");
  });

  it("rejects an enabled size guide whose rows don't match its columns", () => {
    const issues = validateProductAgainstConfig(
      { attributes: { sizeGuide: { enabled: true, columns: ["Size", "Chest"], rows: [["M"]] } }, variants: [{ size: "M", color: "Black" }] },
      configFor("CLOTHING"),
    );
    expect(issues.map((i) => i.path.join("."))).toEqual(["attributes.sizeGuide.rows.0"]);
  });

  it("ignores a stale size guide once the type no longer supports one", () => {
    const issues = validateProductAgainstConfig(
      { attributes: { sizeGuide: { enabled: true, columns: [], rows: [] } }, variants: [{ size: "12ml" }] },
      configFor("FRAGRANCE"),
    );
    expect(issues).toEqual([]);
  });
});

describe("product schemas", () => {
  const base = { name: "Test", categoryId: CUID, basePrice: 10, variants: [{ sku: "SKU-1", stock: 1 }] };

  it("accepts a product without a type — the service resolves it", () => {
    expect(createProductSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a legacy product type outside the enum", () => {
    expect(createProductSchema.safeParse({ ...base, productType: "TOYS" }).success).toBe(false);
  });
});

describe("updateProductSchema", () => {
  it("does not reset the type when the payload omits it", () => {
    const r = updateProductSchema.safeParse({ name: "Renamed" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.productType).toBeUndefined();
      expect(r.data.typeId).toBeUndefined();
    }
  });

  it("leaves size and colour undefined on a variant update that omits them", () => {
    // Regression: size used to default to "" here, which the service then wrote back as "Standard".
    const r = updateProductSchema.safeParse({ variants: [{ id: CUID, sku: "SKU-1", stock: 5 }] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.variants?.[0]?.size).toBeUndefined();
      expect(r.data.variants?.[0]?.color).toBeUndefined();
    }
  });
});

describe("variant labels", () => {
  it("joins size and colour and drops blanks / the placeholder", () => {
    expect(formatVariantLabel("M", "Black")).toBe("M / Black");
    expect(formatVariantLabel("12ml", "")).toBe("12ml");
    expect(formatVariantLabel(NO_SIZE_VALUE, "Tan")).toBe("Tan");
    expect(formatVariantLabel(NO_SIZE_VALUE, "")).toBe("");
    expect(formatVariantLabel("M", "Black", "/")).toBe("M/Black");
  });

  it("never yields a dangling separator or empty parentheses", () => {
    expect(formatVariantSuffix("12ml", "")).toBe(" (12ml)");
    expect(formatVariantSuffix("M", "Black")).toBe(" (M/Black)");
    expect(formatVariantSuffix(NO_SIZE_VALUE, null)).toBe("");
  });
});

describe("default size guides", () => {
  it("gives footwear its own chart instead of the apparel one", () => {
    expect(getDefaultSizeGuide("SHOES").columns).not.toEqual(DEFAULT_SIZE_GUIDE.columns);
    expect(getDefaultSizeGuide("SHOES").columns).toContain("EU");
  });

  it("uses the apparel chart for Clothing", () => {
    expect(getDefaultSizeGuide("CLOTHING")).toBe(DEFAULT_SIZE_GUIDE);
  });
});
