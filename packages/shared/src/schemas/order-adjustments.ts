import { z } from "zod";
import { bdPhoneSchema, nullableString, paginationQuerySchema } from "./common";
import { BD_DIVISIONS } from "../country/bd";
import { checkoutItemSchema } from "./order";
import { returnCompensationEnum } from "./return-request";

/**
 * Order adjustments after placement (docs/ORDER_ADJUSTMENTS.md): modifying an order, cancelling a paid one, item-level
 * returns, store credit and payment links. Every request names WHAT to change — items, quantities, an address, a choice —
 * and never a price, discount, shipping fee, total, stock level or payment status: the server derives all of those.
 */

/** The desired final contents of an order being modified (preview and apply share it). */
export const orderModificationSchema = z.object({
  /** The whole cart after the change: lines kept keep their original price; new units are priced now. */
  items: z.array(checkoutItemSchema).min(1, "An order needs at least one item").max(50),
  /** Recipient / delivery address changes. Omitted = unchanged. */
  shipping: z
    .object({
      customerName: z.string().min(1).max(200).optional(),
      customerPhone: bdPhoneSchema().optional(),
      shippingDivision: z.enum(BD_DIVISIONS),
      shippingDistrict: z.string().min(1).max(120),
      shippingArea: z.string().min(1).max(120),
      shippingAddressLine: z.string().min(1).max(500),
    })
    .optional(),
  reason: nullableString(500),
  /** Apply only: the token of the preview that was confirmed. When the server's numbers no longer match it the change is
   * refused with 409 MODIFICATION_CHANGED and a fresh preview — a changed total is never applied silently. */
  previewToken: z.string().max(128).optional(),
  /** Admin only: on an order that already holds online money, apply an increase now and leave the difference due
   * (collected later — manual payment, payment link) instead of waiting for it to be paid. */
  collectDifferenceLater: z.boolean().optional(),
});

export const cancelOwnOrderSchema = z.object({
  reason: nullableString(500),
});

/** Item-level return on a delivered order (the "kept 1 of 3" parcel): exactly which lines and how many units came back. */
export const recordItemReturnSchema = z.object({
  items: z
    .array(
      z.object({
        orderItemId: z.string().cuid(),
        quantity: z.number().int().min(1).max(10000),
        /** false = the units came back but can't be sold again (damaged): they are written off, not restocked. */
        restock: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(100),
  reason: z.string().min(1).max(200),
  note: nullableString(1000),
  compensation: returnCompensationEnum.default("STORE_CREDIT"),
});

/** Preview of an item-level return: only the lines (what would be valued and credited). */
export const itemReturnPreviewSchema = recordItemReturnSchema.pick({ items: true });

/** Moves money owed back on an order (its refund due) to the customer's store balance instead of refunding it. */
export const issueStoreCreditSchema = z.object({
  /** Omitted = everything currently owed back on the order. Never more than that. */
  amount: z.number().positive().optional(),
  reason: z.string().min(1).max(500),
});

export const paymentLinkChannelEnum = z.enum(["SMS", "EMAIL"]);

export const createPaymentLinkSchema = z.object({
  /** How long the link stays usable: 1 hour to 30 days (default 3 days). */
  expiresInHours: z.number().int().min(1).max(720).default(72),
  /** Send it right away through these channels (the outbox delivers it). Empty = generate only. */
  send: z.array(paymentLinkChannelEnum).max(2).default([]),
  /** A modification waiting for its price difference — the link then collects exactly that difference. */
  modificationId: z.string().cuid().optional(),
});

export const sendPaymentLinkSchema = z.object({
  channels: z.array(paymentLinkChannelEnum).min(1).max(2),
});

export const startPaymentLinkSchema = z.object({
  provider: z.enum(["SSLCOMMERZ", "EPS_PG"]),
});

export const storeCreditListQuerySchema = paginationQuerySchema;

export type OrderModificationInput = z.infer<typeof orderModificationSchema>;
export type CancelOwnOrderInput = z.infer<typeof cancelOwnOrderSchema>;
export type RecordItemReturnInput = z.infer<typeof recordItemReturnSchema>;
export type ItemReturnPreviewInput = z.infer<typeof itemReturnPreviewSchema>;
export type IssueStoreCreditInput = z.infer<typeof issueStoreCreditSchema>;
export type PaymentLinkChannel = z.infer<typeof paymentLinkChannelEnum>;
export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;
export type SendPaymentLinkInput = z.infer<typeof sendPaymentLinkSchema>;
export type StartPaymentLinkInput = z.infer<typeof startPaymentLinkSchema>;
