import { z } from "zod";

export const addWishlistItemSchema = z.object({
  productId: z.string().cuid(),
});

export type AddWishlistItemInput = z.infer<typeof addWishlistItemSchema>;
