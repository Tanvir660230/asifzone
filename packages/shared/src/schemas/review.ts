import { z } from "zod";
import { paginationQuerySchema, nullableString } from "./common";

export const reviewStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED"]);

/** How many photos one review may carry. */
export const REVIEW_IMAGE_LIMIT = 4;

/** A photo uploaded through POST /api/reviews/images — only the store's own review uploads can be attached, never an
 * arbitrary URL. */
export const reviewImageRefSchema = z.string().regex(/^\/uploads\/reviews\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i, "Upload the photo again");

export const createReviewSchema = z.object({
  productId: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  title: nullableString(120),
  body: z.string().min(10).max(2000),
  images: z.array(reviewImageRefSchema).max(REVIEW_IMAGE_LIMIT, `Up to ${REVIEW_IMAGE_LIMIT} photos`).default([]),
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

/** The homepage "Customer reviews" section: approved, written reviews across the store (GET /api/reviews/featured). */
export const featuredReviewsQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(12).default(6),
  minRating: z.coerce.number().int().min(1).max(5).default(4),
});
export type FeaturedReviewsQuery = z.infer<typeof featuredReviewsQuerySchema>;

export interface FeaturedReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  /** First name and last initial only ("Rahim U.") — a public page never shows a customer's full name. */
  customerName: string;
  isVerifiedPurchase: boolean;
  productName: string;
  productSlug: string;
  productImageUrl: string | null;
  createdAt: string;
}
