import { z } from "zod";
import { nullableString } from "./common";

/** Staff-led door-swap exchange and customer-reported item problems (docs/superpowers/plans/2026-11-28-door-swap-exchange.md). */

export const EXCHANGE_REASONS = ["CUSTOMER_SIZE", "CUSTOMER_COLOR", "WRONG_ITEM_SENT", "DEFECT"] as const;
export type ExchangeReasonValue = (typeof EXCHANGE_REASONS)[number];
/** Our fault: the exchange is free and needs a note saying what proves it. */
export const EXCHANGE_OUR_FAULT: readonly ExchangeReasonValue[] = ["WRONG_ITEM_SENT", "DEFECT"];
/** Days after delivery an exchange is accepted without an override reason. */
export const EXCHANGE_WINDOW_DAYS = { customer: 3, ours: 7 } as const;
export const EXCHANGE_REASON_LABEL: Record<ExchangeReasonValue, string> = {
  CUSTOMER_SIZE: "Customer's size change",
  CUSTOMER_COLOR: "Customer's colour change",
  WRONG_ITEM_SENT: "We sent the wrong item",
  DEFECT: "Damaged / faulty item",
};

export const SWAP_STATUSES = ["AWAITING_SWAP", "SWAPPED", "KEPT_BOTH", "REFUSED", "OLD_RECEIVED", "OLD_MISSING"] as const;
export type SwapStatusValue = (typeof SWAP_STATUSES)[number];

export const createDoorSwapSchema = z
  .object({
    orderItemId: z.string().cuid(),
    requestedVariantId: z.string().cuid(),
    reason: z.enum(EXCHANGE_REASONS),
    evidenceNote: nullableString(300),
    /** The customer-reported problem this exchange answers (OrderIssue id), if any. */
    issueId: z.string().cuid().nullable().optional(),
    /** Staff's own delivery fee for a customer-reason exchange; omitted = the store's fee for the order's area. */
    fee: z.number().min(0).max(5000).optional(),
    /** Required when the exchange window has passed. */
    overrideReason: nullableString(200),
    /** Price it without writing anything (the dialog's summary). */
    preview: z.boolean().optional(),
  })
  .refine((v) => !EXCHANGE_OUR_FAULT.includes(v.reason) || (v.evidenceNote ?? "").trim().length >= 3 || Boolean(v.issueId), {
    message: "Say what proves the problem (e.g. WhatsApp photo seen)",
    path: ["evidenceNote"],
  });
export type CreateDoorSwapInput = z.infer<typeof createDoorSwapSchema>;

export const ORDER_ISSUE_KINDS = ["TORN", "STAIN", "BROKEN_PART", "COLOR_DIFFERENT", "WRONG_ITEM", "OTHER"] as const;
export type OrderIssueKindValue = (typeof ORDER_ISSUE_KINDS)[number];
export const ORDER_ISSUE_LABEL: Record<OrderIssueKindValue, string> = {
  TORN: "Torn",
  STAIN: "Stain / dirty",
  BROKEN_PART: "Broken zip / button",
  COLOR_DIFFERENT: "Colour not as shown",
  WRONG_ITEM: "Wrong item",
  OTHER: "Other problem",
};
export const ISSUE_CHANNELS = ["CALL", "WHATSAPP", "MESSENGER", "OTHER"] as const;

export const createOrderIssueSchema = z.object({
  orderItemId: z.string().cuid().nullable().optional(),
  kind: z.enum(ORDER_ISSUE_KINDS),
  channel: z.enum(ISSUE_CHANNELS).default("CALL"),
  note: z.string().trim().min(3, "Write what the customer said").max(500),
});
export type CreateOrderIssueInput = z.infer<typeof createOrderIssueSchema>;
