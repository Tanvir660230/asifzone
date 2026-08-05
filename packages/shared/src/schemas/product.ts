import { z } from "zod";
import { blankToNull, nullableCuid, nullableDate, nullableNumber, nullableString, paginationQuerySchema, slugSchema } from "./common";

export const brandTierEnum = z.enum(["PREMIUM", "PLATINUM", "LUXURY"]);

export const createVariantSchema = z.object({
  id: z.string().cuid().optional(),
  sku: z.string().min(1).max(64),
  barcode: nullableString(64),
  size: z.string().min(1).max(32),
  color: z.string().min(1).max(48),
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

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.preprocess((v) => (v === "" ? undefined : v), slugSchema.optional()),
  description: z.string().max(20_000).default(""),
  categoryId: z.string().cuid(),
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

export const updateProductSchema = createProductSchema.partial({
  name: true,
  categoryId: true,
  basePrice: true,
  variants: true,
});

export const productListQuerySchema = paginationQuerySchema.extend({
  categoryId: z.string().cuid().optional(),
  search: z.string().min(1).max(200).optional(),
  trashed: z.coerce.boolean().optional(),
});

export const bulkProductIdsSchema = z.object({ ids: z.array(z.string().cuid()).min(1).max(500) });
export const bulkProductStatusSchema = bulkProductIdsSchema.extend({ isActive: z.boolean() });
export const bulkProductCategorySchema = bulkProductIdsSchema.extend({ categoryId: z.string().cuid() });

export type BulkProductIdsInput = z.infer<typeof bulkProductIdsSchema>;
export type BulkProductStatusInput = z.infer<typeof bulkProductStatusSchema>;
export type BulkProductCategoryInput = z.infer<typeof bulkProductCategorySchema>;

export const productSortEnum = z.enum(["newest", "price_asc", "price_desc"]);

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
