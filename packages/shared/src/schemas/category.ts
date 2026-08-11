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

// Persists a drag-and-drop reorder within one sibling group at once — every item must share the
// same parentId (the service enforces this), so this can't be used to reparent a category.
export const reorderCategoriesSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().cuid(),
        sortOrder: z.number().int().min(0),
      }),
    )
    .min(1),
});

// Reparents a category (e.g. drag-drop from one parent's list into another's) and places it at
// `sortOrder` within the destination sibling group in one call, instead of a plain field update
// (which would leave the moved category's old sortOrder colliding with its new siblings).
// `newParentId` is required-but-nullable (null = move to top level) — unlike `nullableCuid()`,
// which is also optional, since this endpoint always needs an explicit destination.
export const moveCategorySchema = z.object({
  newParentId: z.preprocess((v) => (v === "" ? null : v), z.string().cuid().nullable()),
  sortOrder: z.number().int().min(0),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
export type MoveCategoryInput = z.infer<typeof moveCategorySchema>;
