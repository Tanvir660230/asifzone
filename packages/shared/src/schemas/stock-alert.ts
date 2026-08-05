import { z } from "zod";

export const createStockAlertSchema = z.object({
  variantId: z.string().cuid(),
});

export type CreateStockAlertInput = z.infer<typeof createStockAlertSchema>;
