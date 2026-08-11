import { z } from "zod";
import { nullableUrl } from "./common";

export const createPaymentMethodSchema = z.object({
  name: z.string().min(1).max(60),
  logoUrl: nullableUrl(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const updatePaymentMethodSchema = createPaymentMethodSchema.partial();

export const reorderPaymentMethodsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().cuid(),
        sortOrder: z.number().int().min(0),
      }),
    )
    .min(1),
});

export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;
export type ReorderPaymentMethodsInput = z.infer<typeof reorderPaymentMethodsSchema>;
