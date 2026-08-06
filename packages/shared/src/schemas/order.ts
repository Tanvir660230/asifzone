import { z } from "zod";
import { nullableEmail, nullableString, paginationQuerySchema } from "./common";

export const orderStatusEnum = z.enum([
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
]);

export const paymentMethodEnum = z.enum(["COD", "SSLCOMMERZ"]);
export const paymentStatusEnum = z.enum(["UNPAID", "PAID", "FAILED", "REFUNDED"]);

/** Client-side fallback shown only before real settings have loaded — the authoritative fee is
 * always looked up from StoreSetting (Dhaka vs. outside-Dhaka) at order-creation time. */
export const SHIPPING_FEE_DHAKA_FALLBACK = 60;
export const SHIPPING_FEE_OUTSIDE_DHAKA_FALLBACK = 120;

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

/** All 64 official districts grouped by division — lets the checkout/address forms offer a
 * courier-style cascading picker (division narrows district) instead of free-text district entry,
 * which was a common source of typos and failed deliveries. */
export const BD_DISTRICTS_BY_DIVISION = {
  Dhaka: [
    "Dhaka",
    "Faridpur",
    "Gazipur",
    "Gopalganj",
    "Kishoreganj",
    "Madaripur",
    "Manikganj",
    "Munshiganj",
    "Narayanganj",
    "Narsingdi",
    "Rajbari",
    "Shariatpur",
    "Tangail",
  ],
  Chattogram: [
    "Bandarban",
    "Brahmanbaria",
    "Chandpur",
    "Chattogram",
    "Cumilla",
    "Cox's Bazar",
    "Feni",
    "Khagrachhari",
    "Lakshmipur",
    "Noakhali",
    "Rangamati",
  ],
  Rajshahi: ["Bogura", "Joypurhat", "Naogaon", "Natore", "Chapainawabganj", "Pabna", "Rajshahi", "Sirajganj"],
  Khulna: ["Bagerhat", "Chuadanga", "Jashore", "Jhenaidah", "Khulna", "Kushtia", "Magura", "Meherpur", "Narail", "Satkhira"],
  Barishal: ["Barguna", "Barishal", "Bhola", "Jhalokati", "Patuakhali", "Pirojpur"],
  Sylhet: ["Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"],
  Rangpur: ["Dinajpur", "Gaibandha", "Kurigram", "Lalmonirhat", "Nilphamari", "Panchagarh", "Rangpur", "Thakurgaon"],
  Mymensingh: ["Jamalpur", "Mymensingh", "Netrokona", "Sherpur"],
} as const satisfies Record<(typeof BD_DIVISIONS)[number], readonly string[]>;

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
  /// The storefront analytics session id (see PageView) — lets revenue be attributed back to a
  /// traffic source/campaign. Optional: omitted for old clients or if tracking failed to init.
  sessionId: z.string().max(64).optional(),
});

export const orderListQuerySchema = paginationQuerySchema.extend({
  status: orderStatusEnum.optional(),
  search: z.string().min(1).max(200).optional(),
});

export const updateOrderStatusSchema = z.object({
  status: orderStatusEnum,
  note: nullableString(500),
});

export const updateOrderDetailsSchema = z.object({
  trackingNumber: nullableString(120),
  carrier: nullableString(80),
  adminNotes: nullableString(2000),
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
export type UpdateOrderDetailsInput = z.infer<typeof updateOrderDetailsSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
export type TrackOrderInput = z.infer<typeof trackOrderSchema>;
export type OrderStatus = z.infer<typeof orderStatusEnum>;
export type PaymentMethod = z.infer<typeof paymentMethodEnum>;
export type PaymentStatus = z.infer<typeof paymentStatusEnum>;
export type BdDivision = (typeof BD_DIVISIONS)[number];
