/** The original hard-coded product types. They are now seeded into the `ProductTypeDef` table (see the
 * catalog migration) and are only kept here as the seed's source of truth and as a last-resort fallback
 * for a product whose type can't be resolved. New types are created in the admin, not here. */
export const LEGACY_PRODUCT_TYPE_KEYS = [
  "CLOTHING",
  "FRAGRANCE",
  "ACCESSORY",
  "WATCH",
  "SHOES",
  "COSMETICS",
  "ISLAMIC_PRODUCT",
  "HOME",
] as const;

/** Values of the Prisma `ProductType` enum, which `Product.productType` still mirrors (CUSTOM for any
 * admin-created type). Checked against schema.prisma by a test, since a DB enum can't be generated from TS. */
export const PRODUCT_TYPE_KEYS = [...LEGACY_PRODUCT_TYPE_KEYS, "CUSTOM"] as const;

export type LegacyProductType = (typeof LEGACY_PRODUCT_TYPE_KEYS)[number];
export type ProductType = (typeof PRODUCT_TYPE_KEYS)[number];

/** Stored in `size` when a product type has no size dimension (or the admin left it blank). Storefront
 * pickers and filters treat it as "no choice", not as a real size. */
export const NO_SIZE_VALUE = "Standard";

export type FieldType = "TEXT" | "TEXTAREA" | "NUMBER" | "SELECT" | "MULTI_SELECT" | "BOOLEAN" | "DATE" | "RICH_TEXT" | "IMAGE" | "URL";

export interface ProductFieldConfig {
  key: string; label: string; type: FieldType; required?: boolean; placeholder?: string; options?: string[]; section?: string;
}

export interface VariantDimensionConfig {
  key: string; label: string; targetField: "size" | "color"; placeholder?: string; options?: string[];
}

export interface ProductTypeConfig {
  type: LegacyProductType; label: string; description: string; fields: ProductFieldConfig[]; variantDimensions: VariantDimensionConfig[]; sections: { key: string; label: string }[];
  /** `defaultChart` is what the storefront and the admin editor start from when the product has no
   * saved guide; it falls back to the generic apparel chart. */
  sizeGuide?: { supported: boolean; defaultEnabled: boolean; defaultChart?: SizeGuideData };
}

export interface SizeGuideData {
  enabled?: boolean;
  title?: string;
  unit?: string;
  columns: string[];
  rows: string[][];
  /** Free-text instructions shown under the table ("Measure over the chest…"). */
  notes?: string;
}

/** Generic apparel chart. Shown for size-guide-enabled types until an admin saves their own, so the
 * admin editor and the storefront modal always start from the same table. */
export const DEFAULT_SIZE_GUIDE: SizeGuideData = {
  title: "Size guide",
  unit: "inch",
  columns: ["Size", "Chest", "Waist", "Length"],
  rows: [
    ["S", "36–38", "30–32", "27"],
    ["M", "39–41", "33–35", "28"],
    ["L", "42–44", "36–38", "29"],
    ["XL", "45–47", "39–41", "30"],
    ["XXL", "48–50", "42–44", "31"],
  ],
};

/** General reference for men's shoes; sizing varies by brand, so admins are expected to edit it. */
export const DEFAULT_SHOE_SIZE_GUIDE: SizeGuideData = {
  title: "Shoe size guide",
  unit: "cm (foot length)",
  columns: ["EU", "UK", "US", "Foot length"],
  rows: [
    ["39", "6", "7", "24.5"],
    ["40", "7", "8", "25.4"],
    ["41", "7.5", "8.5", "26"],
    ["42", "8", "9", "26.7"],
    ["43", "9", "10", "27.3"],
    ["44", "10", "11", "28"],
  ],
};

export const PRODUCT_TYPE_CONFIGS: Record<LegacyProductType, ProductTypeConfig> = {
  CLOTHING: {
    type: "CLOTHING", label: "Clothing", description: "Apparel items with size & color.",
    fields: [
      { key: "material", label: "Material", type: "TEXT", placeholder: "100% Cotton", section: "spec" },
      { key: "fit", label: "Fit", type: "SELECT", options: ["Regular", "Slim", "Relaxed"], section: "spec" },
      { key: "fabric", label: "Fabric", type: "TEXT", placeholder: "Premium Cotton Lawn", section: "spec" },
      { key: "careInstructions", label: "Care Instructions", type: "TEXT", placeholder: "Machine wash cold with like colors", section: "spec" },
    ],
    variantDimensions: [
      { key: "size", label: "Size", targetField: "size", options: ["S", "M", "L", "XL", "XXL"] },
      { key: "color", label: "Color", targetField: "color", options: ["Black", "White", "Navy", "Maroon"] },
    ],
    sections: [{ key: "description", label: "Description" }, { key: "spec", label: "Specifications & Care" }],
    sizeGuide: { supported: true, defaultEnabled: true },
  },
  FRAGRANCE: {
    type: "FRAGRANCE", label: "Fragrance", description: "Perfumes, attars, and body sprays.",
    fields: [
      { key: "fragranceType", label: "Fragrance Type", type: "SELECT", options: ["Attar", "Extrait de Parfum", "EDP", "EDT", "Body Mist"], section: "details" },
      { key: "concentration", label: "Concentration", type: "TEXT", placeholder: "High concentration oil", section: "details" },
      { key: "scentFamily", label: "Scent Family", type: "SELECT", options: ["Woody", "Floral", "Oriental", "Fresh", "Musky", "Citrus"], section: "details" },
      { key: "topNotes", label: "Top Notes", type: "TEXT", placeholder: "Bergamot, Saffron, Lavender", section: "notes" },
      { key: "heartNotes", label: "Heart Notes", type: "TEXT", placeholder: "Rose, Jasmine, Spices", section: "notes" },
      { key: "baseNotes", label: "Base Notes", type: "TEXT", placeholder: "Amber, Musk, Agarwood (Oud)", section: "notes" },
      { key: "longevity", label: "Longevity", type: "TEXT", placeholder: "8–10 hours", section: "details" },
      { key: "gender", label: "Gender / Target", type: "SELECT", options: ["Unisex", "Men", "Women"], section: "details" },
      { key: "alcohol", label: "Alcohol Content", type: "TEXT", placeholder: "Alcohol-free / 80% Vol", section: "details" },
      { key: "ingredients", label: "Ingredients", type: "TEXTAREA", placeholder: "Parfum, Aqua, Essential Oils...", section: "details" },
      { key: "howToUse", label: "How to Use", type: "TEXTAREA", placeholder: "Apply on pulse points...", section: "details" },
    ],
    variantDimensions: [{ key: "volume", label: "Volume", targetField: "size", options: ["3ml", "6ml", "12ml", "50ml", "100ml"] }],
    sections: [{ key: "description", label: "Description" }, { key: "details", label: "Fragrance Details" }, { key: "notes", label: "Olfactory Notes" }],
    sizeGuide: { supported: false, defaultEnabled: false },
  },
  ACCESSORY: {
    type: "ACCESSORY", label: "Accessory", description: "Wallets, belts, caps, and bags.",
    fields: [
      { key: "material", label: "Material", type: "TEXT", placeholder: "Genuine Leather", section: "spec" },
      { key: "dimensions", label: "Dimensions", type: "TEXT", placeholder: "11cm x 9cm", section: "spec" },
    ],
    variantDimensions: [{ key: "color", label: "Color", targetField: "color", options: ["Black", "Brown", "Tan"] }],
    sections: [{ key: "description", label: "Description" }, { key: "spec", label: "Specifications" }],
    sizeGuide: { supported: true, defaultEnabled: false },
  },
  WATCH: {
    type: "WATCH", label: "Watch", description: "Wristwatches and timepieces.",
    fields: [
      { key: "movement", label: "Movement", type: "SELECT", options: ["Quartz", "Automatic", "Mechanical"], section: "details" },
      { key: "warranty", label: "Warranty", type: "TEXT", placeholder: "1 Year International Warranty", section: "warranty" },
      { key: "dialColor", label: "Dial Color", type: "TEXT", placeholder: "Sunburst Blue", section: "details" },
      { key: "waterResistance", label: "Water Resistance", type: "TEXT", placeholder: "3 ATM / 30 Meters", section: "details" },
    ],
    variantDimensions: [
      { key: "caseSize", label: "Case Size", targetField: "size", options: ["38mm", "40mm", "42mm", "44mm"] },
      { key: "strapColor", label: "Strap Color", targetField: "color", options: ["Black", "Brown", "Steel", "Rose Gold"] },
    ],
    sections: [{ key: "description", label: "Description" }, { key: "details", label: "Watch Details" }, { key: "warranty", label: "Warranty & Support" }],
    sizeGuide: { supported: false, defaultEnabled: false },
  },
  SHOES: {
    type: "SHOES", label: "Shoes", description: "Footwear and sandals.",
    fields: [
      { key: "material", label: "Material", type: "TEXT", placeholder: "Full-grain Leather", section: "spec" },
      { key: "soleType", label: "Sole Type", type: "TEXT", placeholder: "Anti-slip Rubber", section: "spec" },
    ],
    variantDimensions: [
      { key: "size", label: "Size", targetField: "size", options: ["39", "40", "41", "42", "43", "44"] },
      { key: "color", label: "Color", targetField: "color", options: ["Black", "Brown", "Tan"] },
    ],
    sections: [{ key: "description", label: "Description" }, { key: "spec", label: "Specifications" }],
    sizeGuide: { supported: true, defaultEnabled: true, defaultChart: DEFAULT_SHOE_SIZE_GUIDE },
  },
  COSMETICS: {
    type: "COSMETICS", label: "Cosmetics", description: "Skincare and makeup items.",
    fields: [
      { key: "skinType", label: "Skin Type", type: "SELECT", options: ["All Skin Types", "Oily", "Dry", "Combination", "Sensitive"], section: "details" },
      { key: "ingredients", label: "Ingredients", type: "TEXTAREA", placeholder: "Aqua, Niacinamide, Hyaluronic Acid...", section: "details" },
    ],
    variantDimensions: [
      { key: "volume", label: "Volume", targetField: "size", options: ["30ml", "50ml", "100ml"] },
      { key: "shade", label: "Shade", targetField: "color", options: ["Fair", "Light", "Medium", "Deep"] },
    ],
    sections: [{ key: "description", label: "Description" }, { key: "details", label: "Cosmetic Details" }],
    sizeGuide: { supported: false, defaultEnabled: false },
  },
  ISLAMIC_PRODUCT: {
    type: "ISLAMIC_PRODUCT", label: "Islamic Product", description: "Prayer mats and books.",
    fields: [
      { key: "material", label: "Material", type: "TEXT", placeholder: "Plush Velvet", section: "spec" },
      { key: "publisher", label: "Publisher / Origin", type: "TEXT", placeholder: "Madinah / Local Artisan", section: "spec" },
    ],
    variantDimensions: [{ key: "edition", label: "Edition / Type", targetField: "size", options: ["Standard", "Deluxe", "Gift Box"] }],
    sections: [{ key: "description", label: "Description" }, { key: "spec", label: "Specifications" }],
    sizeGuide: { supported: false, defaultEnabled: false },
  },
  HOME: {
    type: "HOME", label: "Home", description: "Home decor and diffusers.",
    fields: [
      { key: "material", label: "Material", type: "TEXT", placeholder: "Ceramic / Glass", section: "spec" },
      { key: "dimensions", label: "Dimensions", type: "TEXT", placeholder: "15cm x 15cm", section: "spec" },
    ],
    variantDimensions: [
      { key: "size", label: "Size", targetField: "size", options: ["Small", "Medium", "Large"] },
      { key: "color", label: "Color", targetField: "color", options: ["White", "Wood", "Matte Black"] },
    ],
    sections: [{ key: "description", label: "Description" }, { key: "spec", label: "Specifications" }],
    sizeGuide: { supported: false, defaultEnabled: false },
  },
};

/** Unknown types (e.g. a value from a newer/older deploy) fall back to Clothing rather than crashing. */
export function getProductTypeConfig(productType: string): ProductTypeConfig {
  return PRODUCT_TYPE_CONFIGS[productType as LegacyProductType] ?? PRODUCT_TYPE_CONFIGS.CLOTHING;
}

/** The chart a product of this type starts from: the type's own default, else the generic apparel one. */
export function getDefaultSizeGuide(productType: string): SizeGuideData {
  return getProductTypeConfig(productType).sizeGuide?.defaultChart ?? DEFAULT_SIZE_GUIDE;
}

/** "M / Black", "12ml", "Black" — joins whichever of size/colour is a real value. `Standard` (no size)
 * and blanks are dropped, so products without a colour or size never print a dangling separator. */
export function formatVariantLabel(
  size: string | null | undefined,
  color: string | null | undefined,
  separator = " / ",
): string {
  const parts = [size, color]
    .map((v) => (v ?? "").trim())
    .filter((v) => v !== "" && v !== NO_SIZE_VALUE);
  return parts.join(separator);
}

/** Same as formatVariantLabel but as a ready-to-append " (M/Black)" suffix — empty when there is nothing
 * to show, so "Classic Tee (/)" / "Royal Oud ()" can't happen. */
export function formatVariantSuffix(
  size: string | null | undefined,
  color: string | null | undefined,
  separator = "/",
): string {
  const label = formatVariantLabel(size, color, separator);
  return label ? ` (${label})` : "";
}
