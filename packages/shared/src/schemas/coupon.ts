import { z } from "zod";
import { nullableCuid, nullableDate, nullableNumber, nullableString, paginationQuerySchema } from "./common";

export const couponTypeEnum = z.enum(["PERCENTAGE", "FIXED", "FREE_SHIPPING"]);
export const couponScopeEnum = z.enum(["ALL_PRODUCTS", "SPECIFIC_PRODUCTS", "SPECIFIC_CATEGORIES"]);

export const createCouponSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(64)
    .transform((v) => v.toUpperCase()),
  type: couponTypeEnum,
  // Required for PERCENTAGE/FIXED, ignored for FREE_SHIPPING — enforced in the service layer since
  // updateCouponSchema is a `.partial()` and can't cross-validate against fields the caller omitted.
  value: nullableNumber(),
  scope: couponScopeEnum.default("ALL_PRODUCTS"),
  productIds: z.array(z.string().cuid()).max(500).default([]),
  categoryIds: z.array(z.string().cuid()).max(200).default([]),
  minOrderAmount: nullableNumber(),
  maxDiscountAmount: nullableNumber(),
  minQuantity: z.preprocess((v) => (v === "" || (typeof v === "number" && Number.isNaN(v)) ? undefined : v), z.number().int().positive().nullable().optional()),
  usageLimit: z.preprocess((v) => (v === "" || (typeof v === "number" && Number.isNaN(v)) ? undefined : v), z.number().int().positive().nullable().optional()),
  perCustomerLimit: z.preprocess((v) => (v === "" || (typeof v === "number" && Number.isNaN(v)) ? undefined : v), z.number().int().positive().nullable().optional()),
  firstOrderOnly: z.boolean().default(false),
  startsAt: nullableDate(),
  expiresAt: nullableDate(),
  description: nullableString(500),
  isActive: z.boolean().default(true),
});

export const updateCouponSchema = createCouponSchema.partial();

export const couponListQuerySchema = paginationQuerySchema.extend({
  search: z.string().min(1).max(200).optional(),
  trashed: z.coerce.boolean().optional(),
});

export const couponCartItemSchema = z.object({
  variantId: z.string().cuid(),
  quantity: z.number().int().min(1).max(20),
});

export const bestCouponSchema = z.object({
  subtotal: z.number().positive(),
  items: z.array(couponCartItemSchema).max(50).optional(),
});

export type CouponType = z.infer<typeof couponTypeEnum>;
export type CouponScope = z.infer<typeof couponScopeEnum>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type CouponListQuery = z.infer<typeof couponListQuerySchema>;
export type CouponCartItem = z.infer<typeof couponCartItemSchema>;
export type BestCouponInput = z.infer<typeof bestCouponSchema>;
