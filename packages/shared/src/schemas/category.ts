import { z } from "zod";
import { nullableCuid, nullableString, nullableUrl, slugSchema } from "./common";

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.preprocess((v) => (v === "" ? undefined : v), slugSchema.optional()),
  parentId: nullableCuid(),
  imageUrl: nullableUrl(),
  imageAltText: nullableString(200),
  bannerImageUrl: nullableUrl(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  seoTitle: nullableString(200),
  seoDescription: nullableString(500),
});

export const updateCategorySchema = createCategorySchema.partial();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
