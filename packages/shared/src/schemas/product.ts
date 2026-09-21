import { z } from "zod";
import { blankToNull, nullableCuid, nullableDate, nullableNumber, nullableString, paginationQuerySchema, slugSchema } from "./common";
import { PRODUCT_TYPE_KEYS } from "../config/product-types";

export const brandTierEnum = z.enum(["PREMIUM", "PLATINUM", "LUXURY"]);

export const productTypeEnum = z.enum(PRODUCT_TYPE_KEYS);

export const PRODUCT_STATUSES = ["DRAFT", "READY", "PUBLISHED", "UNPUBLISHED"] as const;
export const productStatusEnum = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatusEnum>;

/** A composition line: a catalog material or a product-specific name (exactly one), optionally with a percentage. */
export const productMaterialSchema = z
  .object({
    materialId: z.preprocess(blankToNull, z.string().min(1).nullable().optional()),
    customName: z.preprocess((v) => (typeof v === "string" ? v.trim() || null : v), z.string().max(80).nullable().optional()),
    percentage: z.preprocess(blankToNull, z.number().gt(0).max(100).nullable().optional()),
  })
  .superRefine((m, ctx) => {
    if (Boolean(m.materialId) === Boolean(m.customName)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pick a material or type a custom one", path: ["materialId"] });
    }
  });

const httpUrl = (max = 2000) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .max(max)
      .regex(/^https?:\/\/\S+$/i, "Must start with http:// or https://")
      .nullable()
      .optional(),
  );

export const createVariantSchema = z.object({
  id: z.string().cuid().optional(),
  sku: z.string().min(1).max(64),
  barcode: nullableString(64),
  // Optional here: whether a size is required depends on the product type, which refineProductByType
  // enforces (types without a size dimension fall back to NO_SIZE_VALUE). Left undefined — not
  // defaulted to "" — so a partial variant update can't be mistaken for "clear the size".
  size: z.string().max(32).optional(),
  sizeLabel: nullableString(32),
  color: nullableString(48),
  colorHex: z.preprocess(
    blankToNull,
    z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
  ),
  price: nullableNumber(),
  costPrice: nullableNumber(),
  stock: z.number().int().min(0).default(0),
  weight: nullableNumber(),
  imageId: nullableCuid(),
  attributeValueIds: z.array(z.string().cuid()).default([]),
});

export const baseProductSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.preprocess((v) => (v === "" ? undefined : v), slugSchema.optional()),
  description: z.string().max(20_000).default(""),
  shortDescription: nullableString(300),
  sortOrder: z.number().int().default(0),
  categoryId: z.string().cuid(),
  /** The product's type row. Omitted on a partial update = keep the current type. */
  typeId: z.string().min(1).optional(),
  /** Deprecated: the legacy enum. Only read when `typeId` is absent (stale clients), to find the matching system type. */
  productType: productTypeEnum.optional(),
  attributes: z
    .record(z.string(), z.unknown())
    .refine((a) => JSON.stringify(a).length <= 100_000, "Attributes are too large")
    .nullable()
    .optional(),
  brand: nullableString(120),
  brandTier: brandTierEnum.default("PREMIUM"),
  basePrice: z.number().positive(),
  compareAtPrice: nullableNumber(),
  costPrice: nullableNumber(),
  taxRate: z.preprocess(blankToNull, z.number().min(0).max(100).nullable().optional()),
  trackInventory: z.boolean().default(true),
  lowStockThreshold: z.number().int().min(0).default(5),
  restockDate: nullableDate(),
  /** Legacy switch, kept for older clients: true = PUBLISHED, false = UNPUBLISHED, unless `status` is sent. */
  isActive: z.boolean().optional(),
  /** Moving to READY or PUBLISHED is refused while a required completeness check is missing. */
  status: productStatusEnum.optional(),
  isFeatured: z.boolean().default(false),
  seoTitle: nullableString(200),
  seoDescription: nullableString(500),
  focusKeyword: nullableString(120),
  ogTitle: nullableString(200),
  ogDescription: nullableString(500),
  ogImageUrl: httpUrl(),
  canonicalUrl: httpUrl(),
  carePresetId: z.preprocess(blankToNull, z.string().min(1).nullable().optional()),
  /** The product's own care steps; when set (non-empty) they replace the preset's. null/[] clears the override. */
  careOverride: z.array(z.string().trim().min(1).max(300)).max(30).nullable().optional(),
  materials: z
    .array(productMaterialSchema)
    .max(12)
    .refine(
      (rows) => rows.reduce((sum, r) => sum + (r.percentage ?? 0), 0) <= 100.005,
      "Material percentages add up to more than 100%",
    )
    .optional(),
  variants: z.array(createVariantSchema).min(1, "At least one variant is required"),
});

export const createProductSchema = baseProductSchema;

// Type-dependent rules (required size/colour, attribute types, size-guide shape) aren't here any more:
// they depend on the product type's template, which is data. See validateProductAgainstConfig.
export const updateProductSchema = baseProductSchema.partial({
  name: true,
  categoryId: true,
  basePrice: true,
  variants: true,
});

export const productListQuerySchema = paginationQuerySchema.extend({
  categoryId: z.string().cuid().optional(),
  status: productStatusEnum.optional(),
  typeId: z.string().min(1).optional(),
  search: z.string().min(1).max(200).optional(),
  trashed: z.coerce.boolean().optional(),
});

export const updateImageAltTextSchema = z.object({ altText: z.string().min(1).max(300) });
export const reorderImagesSchema = z.object({ imageIds: z.array(z.string().cuid()).min(1) });

export const bulkProductIdsSchema = z.object({ ids: z.array(z.string().cuid()).min(1).max(500) });
/** `status` is the real field; `isActive` (true = publish, false = unpublish) is the legacy form, kept for older clients. */
export const bulkProductStatusSchema = bulkProductIdsSchema
  .extend({ status: productStatusEnum.optional(), isActive: z.boolean().optional() })
  .refine((v) => v.status !== undefined || v.isActive !== undefined, "Send a status");
export const bulkProductCategorySchema = bulkProductIdsSchema.extend({ categoryId: z.string().cuid() });

export type UpdateImageAltTextInput = z.infer<typeof updateImageAltTextSchema>;
export type BulkProductIdsInput = z.infer<typeof bulkProductIdsSchema>;
export type BulkProductStatusInput = z.infer<typeof bulkProductStatusSchema>;
export type BulkProductCategoryInput = z.infer<typeof bulkProductCategorySchema>;

export const productSortEnum = z.enum(["newest", "price_asc", "price_desc", "relevance"]);

function csvToArray(value: unknown) {
  if (typeof value === "string" && value.length > 0) return value.split(",");
  return undefined;
}

export const storefrontProductQuerySchema = paginationQuerySchema.extend({
  category: slugSchema.optional(),
  search: z.string().min(1).max(200).optional(),
  featured: z.coerce.boolean().optional(),
  sort: productSortEnum.default("newest"),
  sizes: z.preprocess(csvToArray, z.array(z.string()).optional()),
  colors: z.preprocess(csvToArray, z.array(z.string()).optional()),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
});

export const storefrontFacetsQuerySchema = z.object({
  category: slugSchema.optional(),
  search: z.string().min(1).max(200).optional(),
});

export const suggestQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(10).default(6),
});

export const popularSearchesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const productsByIdsQuerySchema = z.object({
  ids: z.preprocess(csvToArray, z.array(z.string().cuid()).min(1).max(50)),
});

export const trendingQuerySchema = z.object({
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const recommendedQuerySchema = z.object({
  categoryIds: z.preprocess(csvToArray, z.array(z.string().cuid()).min(1)),
  exclude: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type StorefrontProductQuery = z.infer<typeof storefrontProductQuerySchema>;
export type StorefrontFacetsQuery = z.infer<typeof storefrontFacetsQuerySchema>;
export type SuggestQuery = z.infer<typeof suggestQuerySchema>;
export type PopularSearchesQuery = z.infer<typeof popularSearchesQuerySchema>;
export type ProductsByIdsQuery = z.infer<typeof productsByIdsQuerySchema>;
export type TrendingQuery = z.infer<typeof trendingQuerySchema>;
export type RecommendedQuery = z.infer<typeof recommendedQuerySchema>;
export type ProductSort = z.infer<typeof productSortEnum>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type BrandTier = z.infer<typeof brandTierEnum>;
