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

export const reviewReturnRequestSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  adminNote: nullableString(1000),
});

export const returnRequestListQuerySchema = paginationQuerySchema.extend({
  status: returnRequestStatusEnum.optional(),
});

export type CreateReturnRequestInput = z.infer<typeof createReturnRequestSchema>;
export type ReviewReturnRequestInput = z.infer<typeof reviewReturnRequestSchema>;
export type ReturnRequestListQuery = z.infer<typeof returnRequestListQuerySchema>;
export type ReturnRequestStatus = z.infer<typeof returnRequestStatusEnum>;
export type ReturnRequestType = z.infer<typeof returnRequestTypeEnum>;
