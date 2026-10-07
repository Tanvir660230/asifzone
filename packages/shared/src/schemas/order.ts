import { z } from "zod";
import { bdPhoneSchema, nullableEmail, nullableString, paginationQuerySchema } from "./common";
import { couponCartItemSchema } from "./coupon";
import { BD_DIVISIONS } from "../country/bd";

export const orderStatusEnum = z.enum([
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
]);

export const paymentMethodEnum = z.enum(["COD", "SSLCOMMERZ", "EPS_PG"]);
// A projection of the payment ledger (docs/PAYMENT_LEDGER.md §4); PARTIALLY_REFUNDED since Phase 4; PARTIALLY_PAID and
// CREDITED since the order-adjustments phase (docs/ORDER_ADJUSTMENTS.md §5).
export const paymentStatusEnum = z.enum(["UNPAID", "PARTIALLY_PAID", "PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED", "CREDITED"]);

/** Every raw `delivery_status` value Steadfast's API can return (courier.service.ts's
 * mapSteadfastStatusToOrderStatus only understands a subset of these) — shared so the admin
 * courier-status filter offers exactly the values Order.courierStatus can actually hold. */
export const COURIER_DELIVERY_STATUSES = [
  "in_review",
  "pending",
  "hold",
  "delivered_approval_pending",
  "partial_delivered_approval_pending",
  "cancelled_approval_pending",
  "unknown_approval_pending",
  "delivered",
  "partial_delivered",
  "cancelled",
  "unknown",
] as const;

/** Client-side fallback shown only before real settings have loaded — the authoritative fee is
 * always looked up from StoreSetting (Dhaka vs. outside-Dhaka) at order-creation time. */
export const SHIPPING_FEE_DHAKA_FALLBACK = 60;
export const SHIPPING_FEE_OUTSIDE_DHAKA_FALLBACK = 120;

export const checkoutItemSchema = z.object({
  variantId: z.string().cuid(),
  quantity: z.number().int().min(1).max(20),
});

export const checkoutSchema = z.object({
  items: z.array(checkoutItemSchema).min(1, "Cart is empty"),
  customerName: z.string().min(1).max(200),
  customerEmail: nullableEmail(),
  customerPhone: bdPhoneSchema(),
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
  /** The token of the quote the customer was shown (POST /api/v1/checkout/quote). When present, the order is refused
   * with 409 QUOTE_CHANGED if the server's price no longer matches it — a stale price is never charged. Never a price. */
  quoteToken: z.string().max(128).optional(),
  /** Pay as much as possible from the signed-in customer's store balance. A choice, never an amount: the server
   * applies min(balance, total) under a lock. Ignored for guests (docs/ORDER_ADJUSTMENTS.md §6). */
  useStoreCredit: z.boolean().optional(),
});

/** The canonical quote request (POST /api/v1/checkout/quote): what to price, never a price. Address fields are
 * optional — without them the quote says shipping is calculated once an address is chosen. */
export const quoteRequestSchema = z.object({
  items: z.array(checkoutItemSchema).min(1, "Cart is empty").max(100),
  couponCode: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().min(1).max(64).optional()),
  shippingDivision: z.string().max(120).optional(),
  shippingDistrict: z.string().max(120).optional(),
  shippingPostcode: z.string().max(20).optional(),
  /** Lets the admin "Create order" page quote for a specific customer (per-customer coupon limits). Admin only. */
  customerId: z.string().cuid().optional(),
});

/** Powers the admin "Create order" page (phone/Facebook orders entered by staff) — reuses the same
 * item/customer/shipping shape as checkoutSchema (so it goes through the exact same createOrder
 * pipeline: atomic stock decrement, flash-sale/coupon pricing, product/price snapshotting) but
 * swaps the online-gateway payment path for one that doesn't make sense with no admin at a
 * keyboard on the other end: paymentMethod is COD-only, and `markPaid` lets staff record a sale
 * already settled outside the system (cash in hand, bKash/Nagad) without faking a gateway
 * transaction. `customerId` lets staff attach the order to an existing customer they looked up
 * instead of falling back to checkoutSchema's guest phone/email matching. */
export const adminCreateOrderSchema = z.object({
  items: z.array(checkoutItemSchema).min(1, "Add at least one item"),
  customerId: z.string().cuid().optional(),
  customerName: z.string().min(1).max(200),
  customerEmail: nullableEmail(),
  customerPhone: bdPhoneSchema(),
  shippingDivision: z.enum(BD_DIVISIONS),
  shippingDistrict: z.string().min(1).max(120),
  shippingArea: z.string().min(1).max(120),
  shippingAddressLine: z.string().min(1).max(500),
  paymentMethod: z.literal("COD"),
  markPaid: z.boolean().optional(),
  /** Owner decision D24: a phone order is confirmed on the call that placed it — create it CONFIRMED (same transaction).
   * Omitted / false keeps the old behaviour (PENDING). The admin form sends true by default. */
  confirmNow: z.boolean().optional(),
  /** Pay from the selected customer's store balance first (requires `customerId`); the rest stays due. */
  useStoreCredit: z.boolean().optional(),
  couponCode: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).max(64).optional()),
  notes: nullableString(500),
  /** Same stale-quote guard as checkout (see checkoutSchema.quoteToken). */
  quoteToken: z.string().max(128).optional(),
});

function csvToStatusArray(value: unknown) {
  if (typeof value === "string" && value.length > 0) return value.split(",");
  return undefined;
}

export const orderListQuerySchema = paginationQuerySchema.extend({
  status: orderStatusEnum.optional(),
  // Comma-separated alternative to `status` for quick filters that mean "one of several statuses"
  // (e.g. Cancelled/Returned) — kept as a separate param so every existing single-status caller is unaffected.
  statusIn: z.preprocess(csvToStatusArray, z.array(orderStatusEnum).optional()),
  paymentStatus: paymentStatusEnum.optional(),
  paymentMethod: paymentMethodEnum.optional(),
  search: z.string().min(1).max(200).optional(),
  // "true" = only soft-deleted orders (the admin restore view); omitted/"false" = normal listing.
  deleted: z.enum(["true", "false"]).optional(),
  // "true"/"false" filters on whether courierConsignmentId is set — lets an admin isolate orders
  // that still need to be handed to a courier (the bulk-booking workflow's main use case).
  courierBooked: z.enum(["true", "false"]).optional(),
  // Raw Steadfast delivery_status string (e.g. "in_review", "delivered", "cancelled") — stored as-is
  // on Order.courierStatus, so filtered as-is rather than through our own OrderStatus enum.
  courierStatus: z.string().min(1).max(50).optional(),
  shippingDivision: z.enum(BD_DIVISIONS).optional(),
  shippingDistrict: z.string().min(1).max(120).optional(),
  // "true" = only PENDING orders whose confirmation-call follow-up is due now or overdue
  // (followUpAt <= now) — the callback queue. No "false" variant; omit the param for the normal listing.
  followUpDue: z.enum(["true"]).optional(),
  // "true" = every order a person has to act on (the "Needs action" queue) — one predicate shared with the stats count.
  needsAction: z.enum(["true"]).optional(),
  // "true" = only CANCELLED orders still holding money (paymentStatus PAID or PARTIALLY_REFUNDED) — the refund-risk
  // queue behind getOrderStats().cancelledButPaidCount. No "false" variant; omit for the normal listing.
  cancelledButPaid: z.enum(["true"]).optional(),
  // "true" = only RETURNED orders still holding money — the "returned, refund may be owed" alert's queue.
  refundDue: z.enum(["true"]).optional(),
  // "true" = only booked orders the courier has put on hold or whose last status sync failed.
  courierIssue: z.enum(["true"]).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  // Powers the sortable column headers on the admin orders table — restricted to plain scalar
  // columns Prisma can order by directly (no relations/joins).
  sortBy: z.enum(["orderNumber", "customerName", "paymentStatus", "total", "status", "createdAt"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

export const bulkOrderIdsSchema = z.object({ ids: z.array(z.string().cuid()).min(1).max(500) });

/** Owner decision D22 (docs/BUSINESS_DECISIONS.md, 2026-10-08): an admin cancelling an order says why. The reason is the status
 * note, so it lands on the order timeline and in the audit trail. Courier reports and customer self-cancel write their
 * own note and don't come through these schemas. */
export const CANCELLATION_REASON_MIN_LENGTH = 3;
export function cancellationReasonMissing(status: string, note: string | null | undefined): boolean {
  return status === "CANCELLED" && (note ?? "").trim().length < CANCELLATION_REASON_MIN_LENGTH;
}
const requireCancellationReason = <T extends { status: string; note?: string | null }>(value: T, ctx: z.RefinementCtx) => {
  if (cancellationReasonMissing(value.status, value.note)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "Give a reason for cancelling this order" });
  }
};

export const bulkOrderStatusSchema = bulkOrderIdsSchema
  .extend({ status: orderStatusEnum, note: nullableString(500) })
  .superRefine(requireCancellationReason);
export const bulkCourierBookSchema = bulkOrderIdsSchema;
export const bulkDeliveryScoreCheckSchema = bulkOrderIdsSchema;

export const updateOrderStatusSchema = z
  .object({
    status: orderStatusEnum,
    note: nullableString(500),
  })
  .superRefine(requireCancellationReason);

export const updateOrderDetailsSchema = z.object({
  trackingNumber: nullableString(120),
  carrier: nullableString(80),
  adminNotes: nullableString(2000),
  // Lets an admin correct a customer/shipping mistake caught during the pre-shipping confirmation
  // call — optional (not nullable) because these columns are required strings on Order; there's no
  // valid "clear it" operation, only "replace it". Same validators as adminCreateOrderSchema so a
  // corrected value has to meet the same bar a fresh order would.
  customerName: z.string().min(1).max(200).optional(),
  customerPhone: bdPhoneSchema().optional(),
  shippingDivision: z.enum(BD_DIVISIONS).optional(),
  shippingDistrict: z.string().min(1).max(120).optional(),
  shippingArea: z.string().min(1).max(120).optional(),
  shippingAddressLine: z.string().min(1).max(500).optional(),
});

/** "Hold — call back later": the outcome of a confirmation call that was neither a clear yes
 * (→ CONFIRMED) nor a clear no (→ CANCELLED) — order.status is deliberately left untouched. */
export const holdOrderSchema = z.object({
  followUpAt: z.coerce.date(),
  note: nullableString(500),
});

/** A manual nudge to the order total an admin applies during the confirmation call — negative for
 * a negotiated/goodwill discount, positive for a surcharge. Replaces whatever priceAdjustment was
 * already on the order (not additive), so the UI always sends the new total adjustment, not a delta. */
export const adjustOrderPriceSchema = z.object({
  priceAdjustment: z.coerce.number().min(-100000).max(100000),
  note: nullableString(500),
});

/** Admin resolves a PARTIALLY_DELIVERED order (Steadfast "partial_delivered") by declaring how
 * many units of each line item actually came back — anything not listed (or listed as 0) is
 * assumed kept by the customer. See reconcilePartialDelivery in order.service.ts. */
export const reconcilePartialDeliverySchema = z.object({
  items: z
    .array(
      z.object({
        orderItemId: z.string().cuid(),
        returnedQuantity: z.number().int().min(0).max(10000),
      }),
    )
    .min(1)
    .max(100),
});

export const validateCouponSchema = z.object({
  code: z.string().min(1).max(64),
  subtotal: z.number().positive(),
  items: z.array(couponCartItemSchema).max(50).optional(),
});

export const trackOrderSchema = z.object({
  orderNumber: z.string().min(1).max(64),
  phone: bdPhoneSchema(),
});

// orderNumber comes from the route param (/orders/:orderNumber/retry-payment), not the body — same
// ownership check as trackOrder (phone must match), so only the customer who placed the order can
// start a new payment attempt on it.
export const retryPaymentSchema = z.object({
  phone: bdPhoneSchema(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type AdminCreateOrderInput = z.infer<typeof adminCreateOrderSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type UpdateOrderDetailsInput = z.infer<typeof updateOrderDetailsSchema>;
export type HoldOrderInput = z.infer<typeof holdOrderSchema>;
export type AdjustOrderPriceInput = z.infer<typeof adjustOrderPriceSchema>;
export type ReconcilePartialDeliveryInput = z.infer<typeof reconcilePartialDeliverySchema>;
export type BulkOrderIdsInput = z.infer<typeof bulkOrderIdsSchema>;
export type BulkOrderStatusInput = z.infer<typeof bulkOrderStatusSchema>;

/** Result of a bulk status change: each order goes through the state machine on its own, so some can be refused. */
export interface BulkOrderStatusResult {
  updated: string[];
  unchanged: string[];
  failed: Array<{ id: string; orderNumber: string | null; reason: string }>;
}
export type BulkCourierBookInput = z.infer<typeof bulkCourierBookSchema>;
export type BulkDeliveryScoreCheckInput = z.infer<typeof bulkDeliveryScoreCheckSchema>;
export type QuoteRequestInput = z.infer<typeof quoteRequestSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
export type TrackOrderInput = z.infer<typeof trackOrderSchema>;
export type RetryPaymentInput = z.infer<typeof retryPaymentSchema>;
export type OrderStatus = z.infer<typeof orderStatusEnum>;
export type PaymentMethod = z.infer<typeof paymentMethodEnum>;
export type PaymentStatus = z.infer<typeof paymentStatusEnum>;
export type BdDivision = (typeof BD_DIVISIONS)[number];
