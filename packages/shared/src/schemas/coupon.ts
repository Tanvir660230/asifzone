import { z } from "zod";
import { nullableNumber, paginationQuerySchema } from "./common";
import { discountTypeEnum } from "./flash-sale";

export const createCouponSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(64)
    .transform((v) => v.toUpperCase()),
  type: discountTypeEnum,
  value: z.number().positive(),
  minOrderAmount: nullableNumber(),
  maxDiscountAmount: nullableNumber(),
  usageLimit: z.preprocess((v) => (v === "" || (typeof v === "number" && Number.isNaN(v)) ? undefined : v), z.number().int().positive().nullable().optional()),
  expiresAt: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
  isActive: z.boolean().default(true),
});

export const updateCouponSchema = createCouponSchema.partial();

export const couponListQuerySchema = paginationQuerySchema.extend({
  search: z.string().min(1).max(200).optional(),
});

export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type CouponListQuery = z.infer<typeof couponListQuerySchema>;
