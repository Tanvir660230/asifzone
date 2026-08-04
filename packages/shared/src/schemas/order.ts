import { z } from "zod";
import { nullableEmail, nullableString, paginationQuerySchema } from "./common";

export const orderStatusEnum = z.enum([
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);

export const paymentMethodEnum = z.enum(["COD", "SSLCOMMERZ"]);
export const paymentStatusEnum = z.enum(["UNPAID", "PAID", "FAILED", "REFUNDED"]);

/** Flat-rate shipping for MVP — becomes zone-based/admin-configurable in a later phase. */
export const SHIPPING_FEE_FLAT = 80;

export const BD_DIVISIONS = [
  "Dhaka",
  "Chattogram",
  "Rajshahi",
  "Khulna",
  "Barishal",
  "Sylhet",
  "Rangpur",
  "Mymensingh",
] as const;

export const checkoutItemSchema = z.object({
  variantId: z.string().cuid(),
  quantity: z.number().int().min(1).max(20),
});

export const checkoutSchema = z.object({
  items: z.array(checkoutItemSchema).min(1, "Cart is empty"),
  customerName: z.string().min(1).max(200),
  customerEmail: nullableEmail(),
  customerPhone: z.string().min(6).max(20),
  shippingDivision: z.enum(BD_DIVISIONS),
  shippingDistrict: z.string().min(1).max(120),
  shippingArea: z.string().min(1).max(120),
  shippingAddressLine: z.string().min(1).max(500),
  paymentMethod: paymentMethodEnum,
  couponCode: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).max(64).optional()),
  notes: nullableString(500),
});

export const orderListQuerySchema = paginationQuerySchema.extend({
  status: orderStatusEnum.optional(),
  search: z.string().min(1).max(200).optional(),
});

export const updateOrderStatusSchema = z.object({
  status: orderStatusEnum,
});

export const validateCouponSchema = z.object({
  code: z.string().min(1).max(64),
  subtotal: z.number().positive(),
});

export const trackOrderSchema = z.object({
  orderNumber: z.string().min(1).max(64),
  phone: z.string().min(6).max(20),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
export type TrackOrderInput = z.infer<typeof trackOrderSchema>;
export type OrderStatus = z.infer<typeof orderStatusEnum>;
export type PaymentMethod = z.infer<typeof paymentMethodEnum>;
export type PaymentStatus = z.infer<typeof paymentStatusEnum>;
export type BdDivision = (typeof BD_DIVISIONS)[number];
