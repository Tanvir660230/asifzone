import { z } from "zod";
import { paginationQuerySchema, nullableString } from "./common";

export const reviewStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED"]);

export const createReviewSchema = z.object({
  productId: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  title: nullableString(120),
  body: z.string().min(10).max(2000),
});

export const moderateReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

export const reviewListQuerySchema = paginationQuerySchema.extend({
  productId: z.string().cuid(),
});

export const myReviewQuerySchema = z.object({
  productId: z.string().cuid(),
});

export const adminReviewListQuerySchema = paginationQuerySchema.extend({
  status: reviewStatusEnum.optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;
export type MyReviewQuery = z.infer<typeof myReviewQuerySchema>;
export type AdminReviewListQuery = z.infer<typeof adminReviewListQuerySchema>;
export type ReviewStatus = z.infer<typeof reviewStatusEnum>;
