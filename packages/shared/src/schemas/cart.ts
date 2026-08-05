import { z } from "zod";

export const syncCartItemSchema = z.object({
  variantId: z.string().cuid(),
  quantity: z.number().int().min(1).max(20),
});

export const syncCartSchema = z.object({
  items: z.array(syncCartItemSchema).max(100),
});

export type SyncCartItemInput = z.infer<typeof syncCartItemSchema>;
export type SyncCartInput = z.infer<typeof syncCartSchema>;
