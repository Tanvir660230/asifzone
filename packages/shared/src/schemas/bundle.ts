import { z } from "zod";
import { paginationQuerySchema } from "./common";
import { discountTypeEnum } from "./flash-sale";

export const createBundleSchema = z.object({
  name: z.string().min(1).max(200),
  anchorCategoryId: z.string().cuid(),
  discountType: discountTypeEnum,
  discountValue: z.number().positive(),
  minSuggestedCategories: z.number().int().positive().default(1),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  suggestionCategoryIds: z.array(z.string().cuid()).min(1),
});

export const updateBundleSchema = createBundleSchema.partial();

export const bundleListQuerySchema = paginationQuerySchema;

export const bundlePreviewSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().cuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

export type CreateBundleInput = z.infer<typeof createBundleSchema>;
export type UpdateBundleInput = z.infer<typeof updateBundleSchema>;
export type BundleListQuery = z.infer<typeof bundleListQuerySchema>;
export type BundlePreviewInput = z.infer<typeof bundlePreviewSchema>;
