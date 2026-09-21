import { z } from "zod";
import { blankToNull, nullableCuid, nullableDate, nullableNumber, nullableString, paginationQuerySchema, slugSchema } from "./common";
import { getProductTypeConfig } from "../config/product-types";

export const brandTierEnum = z.enum(["PREMIUM", "PLATINUM", "LUXURY"]);

export const productTypeEnum = z.enum([
  "CLOTHING",
  "FRAGRANCE",
  "ACCESSORY",
  "WATCH",
  "SHOES",
  "COSMETICS",
  "ISLAMIC_PRODUCT",
  "HOME",
]);

export const createVariantSchema = z.object({
  id: z.string().cuid().optional(),
  sku: z.string().min(1).max(64),
  barcode: nullableString(64),
  // Blank is allowed here: whether a size is required depends on the product type, which
  // refineProductByType enforces (types without a size dimension fall back to "Standard").
  size: z.string().max(32).default(""),
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
  productType: productTypeEnum.default("CLOTHING"),
  attributes: z.record(z.string(), z.unknown()).nullable().optional(),
  brand: nullableString(120),
  brandTier: brandTierEnum.default("PREMIUM"),
  basePrice: z.number().positive(),
  compareAtPrice: nullableNumber(),
  costPrice: nullableNumber(),
  taxRate: z.preprocess(blankToNull, z.number().min(0).max(100).nullable().optional()),
  trackInventory: z.boolean().default(true),
  lowStockThreshold: z.number().int().min(0).default(5),
  restockDate: nullableDate(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  seoTitle: nullableString(200),
  seoDescription: nullableString(500),
  variants: z.array(createVariantSchema).min(1, "At least one variant is required"),
});

interface ProductTypeRefineInput {
  productType: z.infer<typeof productTypeEnum>;
  attributes?: Record<string, unknown> | null;
  variants?: z.infer<typeof createVariantSchema>[];
}

function refineProductByType(data: ProductTypeRefineInput, ctx: z.RefinementCtx) {
  const config = getProductTypeConfig(data.productType);
  const needsSize = config.variantDimensions.some((d) => d.targetField === "size");
  const needsColor = config.variantDimensions.some((d) => d.targetField === "color");
  const sizeLabel = config.variantDimensions.find((d) => d.targetField === "size")?.label ?? "Size";
  const colorLabel = config.variantDimensions.find((d) => d.targetField === "color")?.label ?? "Color";

  const attrs = (data.attributes ?? {}) as Record<string, any>;
  const sizeGuide = attrs.sizeGuide;
  // Only validated for types that show a size guide — switching a product to a type without one
  // leaves the old guide in `attributes`, and it must not block saving.
  if (config.sizeGuide?.supported && sizeGuide && typeof sizeGuide === "object" && sizeGuide.enabled === true) {
    if (!Array.isArray(sizeGuide.columns) || sizeGuide.columns.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Size guide must have at least one column",
        path: ["attributes", "sizeGuide", "columns"],
      });
    }
    if (!Array.isArray(sizeGuide.rows) || sizeGuide.rows.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Size guide must have at least one row",
        path: ["attributes", "sizeGuide", "rows"],
      });
    } else {
      sizeGuide.rows.forEach((row: any, rIdx: number) => {
        if (!Array.isArray(row) || row.length !== (sizeGuide.columns?.length || 0)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Row ${rIdx + 1} must match the number of columns`,
            path: ["attributes", "sizeGuide", "rows", rIdx],
          });
        }
      });
    }
  }

  data.variants?.forEach((v, idx) => {
    if (needsSize && (!v.size || v.size.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${sizeLabel} is required`,
        path: ["variants", idx, "size"],
      });
    } else if (!v.size) {
      v.size = "Standard";
    }

    if (needsColor && (!v.color || v.color.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${colorLabel} is required`,
        path: ["variants", idx, "color"],
      });
    } else if (!v.color) {
      v.color = "";
    }
  });
}

export const createProductSchema = baseProductSchema.superRefine((data, ctx) => refineProductByType(data, ctx));

// productType is optional on update: with its `.default("CLOTHING")` a partial payload (any client
// that doesn't resend it) would silently reset the product's type. The per-type checks only run
// when the payload says which type it is.
export const updateProductSchema = baseProductSchema
  .partial({
    name: true,
    categoryId: true,
    basePrice: true,
    variants: true,
    productType: true,
  })
  .superRefine((data, ctx) => {
    if (data.productType) refineProductByType({ ...data, productType: data.productType }, ctx);
  });

export const productListQuerySchema = paginationQuerySchema.extend({
  categoryId: z.string().cuid().optional(),
  search: z.string().min(1).max(200).optional(),
  trashed: z.coerce.boolean().optional(),
});

export const updateImageAltTextSchema = z.object({ altText: z.string().min(1).max(300) });
export const reorderImagesSchema = z.object({ imageIds: z.array(z.string().cuid()).min(1) });

export const bulkProductIdsSchema = z.object({ ids: z.array(z.string().cuid()).min(1).max(500) });
export const bulkProductStatusSchema = bulkProductIdsSchema.extend({ isActive: z.boolean() });
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
