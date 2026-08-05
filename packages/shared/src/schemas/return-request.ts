import { z } from "zod";
import { nullableString, paginationQuerySchema } from "./common";

export const returnRequestStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED"]);

export const createReturnRequestSchema = z.object({
  orderId: z.string().cuid(),
  reason: z.string().min(1).max(200),
  note: nullableString(1000),
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
