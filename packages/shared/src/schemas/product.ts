import { z } from "zod";
import { blankToNull, nullableNumber, nullableString, paginationQuerySchema, slugSchema } from "./common";

export const brandTierEnum = z.enum(["PREMIUM", "PLATINUM", "LUXURY"]);

export const createVariantSchema = z.object({
  id: z.string().cuid().optional(),
  sku: z.string().min(1).max(64),
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
  stock: z.number().int().min(0).default(0),
  weight: nullableNumber(),
});

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.preprocess((v) => (v === "" ? undefined : v), slugSchema.optional()),
  description: z.string().max(10_000).default(""),
  categoryId: z.string().cuid(),
  brandTier: brandTierEnum.default("PREMIUM"),
  basePrice: z.number().positive(),
  compareAtPrice: nullableNumber(),
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
});

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

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type StorefrontProductQuery = z.infer<typeof storefrontProductQuerySchema>;
export type StorefrontFacetsQuery = z.infer<typeof storefrontFacetsQuerySchema>;
export type ProductSort = z.infer<typeof productSortEnum>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type BrandTier = z.infer<typeof brandTierEnum>;
