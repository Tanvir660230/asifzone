import { z } from "zod";
import { nullableCuid, nullableUrl, slugSchema } from "./common";

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.preprocess((v) => (v === "" ? undefined : v), slugSchema.optional()),
  parentId: nullableCuid(),
  imageUrl: nullableUrl(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = createCategorySchema.partial();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
