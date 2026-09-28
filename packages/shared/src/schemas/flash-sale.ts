import { z } from "zod";
import { blankToNull, nullableUrl } from "./common";

export const discountTypeEnum = z.enum(["PERCENTAGE", "FIXED"]);

export const createFlashSaleSchema = z
  .object({
    name: z.string().min(1).max(200),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    bannerImageUrl: nullableUrl(),
    /** The admin's switch (see TARGET_ARCHITECTURE §16a). A disabled sale is never live; the scheduler never re-enables it. */
    enabled: z.boolean().default(true),
  })
  .refine((data) => data.endsAt > data.startsAt, { message: "End time must be after start time", path: ["endsAt"] });

export const updateFlashSaleSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    bannerImageUrl: nullableUrl(),
    enabled: z.boolean().optional(),
    /** Deprecated alias for `enabled` (older admin clients). `isActive` itself is derived and never written from input. */
    isActive: z.boolean().optional(),
  })
  .transform(({ isActive, ...rest }) => (rest.enabled === undefined && isActive !== undefined ? { ...rest, enabled: isActive } : rest));

export const addFlashSaleItemSchema = z.object({
  productId: z.string().cuid(),
  discountType: discountTypeEnum,
  discountValue: z.number().positive(),
  stockLimit: z.preprocess(blankToNull, z.number().int().positive().nullable().optional()),
});

export type CreateFlashSaleInput = z.infer<typeof createFlashSaleSchema>;
export type UpdateFlashSaleInput = z.infer<typeof updateFlashSaleSchema>;
export type AddFlashSaleItemInput = z.infer<typeof addFlashSaleItemSchema>;
export type DiscountType = z.infer<typeof discountTypeEnum>;
