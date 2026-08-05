import { z } from "zod";
import { slugSchema } from "./common";

export const createAttributeValueSchema = z.object({
  id: z.string().cuid().optional(),
  value: z.string().min(1).max(80),
  colorHex: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
  ),
  sortOrder: z.number().int().default(0),
});

export const createAttributeSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.preprocess((v) => (v === "" ? undefined : v), slugSchema.optional()),
  sortOrder: z.number().int().default(0),
  values: z.array(createAttributeValueSchema).default([]),
});

export const updateAttributeSchema = createAttributeSchema.partial({ name: true });

export const createAttributeValueOnlySchema = createAttributeValueSchema.omit({ id: true });

export type CreateAttributeValueInput = z.infer<typeof createAttributeValueSchema>;
export type CreateAttributeInput = z.infer<typeof createAttributeSchema>;
export type UpdateAttributeInput = z.infer<typeof updateAttributeSchema>;
export type CreateAttributeValueOnlyInput = z.infer<typeof createAttributeValueOnlySchema>;
