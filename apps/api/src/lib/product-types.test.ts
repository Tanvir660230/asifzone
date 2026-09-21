import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIZE_GUIDE,
  NO_SIZE_VALUE,
  PRODUCT_TYPE_CONFIGS,
  PRODUCT_TYPE_KEYS,
  createProductSchema,
  formatVariantLabel,
  formatVariantSuffix,
  getDefaultSizeGuide,
  getProductTypeConfig,
  updateProductSchema,
} from "@clothing-brand/shared";

// Any valid cuid — the schema only checks the shape.
const CUID = "ckabcdefghijklmnopqrstuvw";
const base = { name: "Test", categoryId: CUID, basePrice: 10 };

function createWith(productType: string, variant: Record<string, unknown>) {
  return createProductSchema.safeParse({ ...base, productType, variants: [{ sku: "SKU-1", stock: 1, ...variant }] });
}

describe("product type registry", () => {
  it("matches the Prisma ProductType enum exactly", () => {
    // A DB enum can't be generated from TS, so this is the guard against the two drifting apart:
    // adding a type means config + Prisma enum + migration, and forgetting one half fails here.
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const block = /enum ProductType \{([^}]*)\}/.exec(schema)?.[1] ?? "";
    const prismaValues = block.split(/\s+/).filter(Boolean);
    expect([...prismaValues].sort()).toEqual([...PRODUCT_TYPE_KEYS].sort());
  });

  it("has one config per type, keyed by its own type", () => {
    expect(Object.keys(PRODUCT_TYPE_CONFIGS).sort()).toEqual([...PRODUCT_TYPE_KEYS].sort());
    for (const key of PRODUCT_TYPE_KEYS) expect(PRODUCT_TYPE_CONFIGS[key].type).toBe(key);
  });

  it("falls back to Clothing for an unknown type instead of throwing", () => {
    expect(getProductTypeConfig("TOYS").type).toBe("CLOTHING");
  });
});

describe("createProductSchema per-type variant rules", () => {
  it("requires size and colour for Clothing", () => {
    const r = createWith("CLOTHING", {});
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join("."))).toEqual(["variants.0.size", "variants.0.color"]);
  });

  it("needs only a colour for Accessory and stores the no-size placeholder", () => {
    const r = createWith("ACCESSORY", { color: "Tan" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.variants[0]).toMatchObject({ size: NO_SIZE_VALUE, color: "Tan" });
  });

  it("needs only a volume for Fragrance and leaves colour blank", () => {
    const r = createWith("FRAGRANCE", { size: "12ml" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.variants[0]).toMatchObject({ size: "12ml", color: "" });
  });

  it("names the type's own dimension in the error", () => {
    const r = createWith("ISLAMIC_PRODUCT", {});
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Edition / Type is required");
  });

  it("rejects a product type outside the registry", () => {
    expect(createWith("TOYS", { size: "M", color: "Red" }).success).toBe(false);
  });

  it("rejects an enabled size guide whose rows don't match its columns", () => {
    const r = createProductSchema.safeParse({
      ...base,
      productType: "CLOTHING",
      attributes: { sizeGuide: { enabled: true, columns: ["Size", "Chest"], rows: [["M"]] } },
      variants: [{ sku: "SKU-1", stock: 1, size: "M", color: "Black" }],
    });
    expect(r.success).toBe(false);
  });

  it("ignores a stale size guide once the type no longer supports one", () => {
    const r = createProductSchema.safeParse({
      ...base,
      productType: "FRAGRANCE",
      attributes: { sizeGuide: { enabled: true, columns: [], rows: [] } },
      variants: [{ sku: "SKU-1", stock: 1, size: "12ml" }],
    });
    expect(r.success).toBe(true);
  });
});

describe("updateProductSchema", () => {
  it("does not reset productType when the payload omits it", () => {
    const r = updateProductSchema.safeParse({ name: "Renamed" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.productType).toBeUndefined();
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
