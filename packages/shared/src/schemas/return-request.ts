import { z } from "zod";
import { nullableString, paginationQuerySchema } from "./common";

export const returnRequestStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export const returnRequestTypeEnum = z.enum(["RETURN", "EXCHANGE"]);

export const createReturnRequestSchema = z
  .object({
    orderId: z.string().cuid(),
    type: returnRequestTypeEnum.default("RETURN"),
    reason: z.string().min(1).max(200),
    note: nullableString(1000),
    // EXCHANGE only — which line item is being swapped, and the desired replacement variant
    // (same product, different size/color). Validated as required together only for EXCHANGE
    // below, since RETURN never sends either.
    orderItemId: z.string().cuid().optional(),
    requestedVariantId: z.string().cuid().optional(),
  })
  .refine((data) => data.type !== "EXCHANGE" || (data.orderItemId && data.requestedVariantId), {
    message: "Select the item and the size/color you'd like to exchange it for",
    path: ["requestedVariantId"],
  });

/** What the customer gets back for an approved return / exchange downgrade: store credit (store-use only), a refund
 * owed (REQUESTED, paid out by staff), or nothing recorded now. Omitted = the default for the request type
 * (docs/ORDER_ADJUSTMENTS.md §8–9). */
export const returnCompensationEnum = z.enum(["STORE_CREDIT", "REFUND", "NONE"]);

export const reviewReturnRequestSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),
    adminNote: nullableString(1000),
    compensation: returnCompensationEnum.optional(),
  })
  // DR-8: a rejection says why — the customer sees this note on their order.
  .superRefine((value, ctx) => {
    if (value.status === "REJECTED" && (value.adminNote ?? "").trim().length < 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adminNote"], message: "Tell the customer why the request is rejected" });
    }
  });

export const returnRequestListQuerySchema = paginationQuerySchema.extend({
  status: returnRequestStatusEnum.optional(),
});

export type CreateReturnRequestInput = z.infer<typeof createReturnRequestSchema>;
export type ReturnCompensation = z.infer<typeof returnCompensationEnum>;
export type ReviewReturnRequestInput = z.infer<typeof reviewReturnRequestSchema>;
export type ReturnRequestListQuery = z.infer<typeof returnRequestListQuerySchema>;
export type ReturnRequestStatus = z.infer<typeof returnRequestStatusEnum>;
export type ReturnRequestType = z.infer<typeof returnRequestTypeEnum>;
