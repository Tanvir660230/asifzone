import { Router } from "express";
import { linkReviewSchema, type LinkReviewInput } from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import { validate } from "../../middlewares/validate";
import { reviewLinkRateLimit } from "../../middlewares/rate-limit";
import { getReviewRequestView, submitReviewFromLink } from "./review-request";

/** Public: the customer's review page from the SMS two days after delivery. The signed code in the path is the key. */
export const reviewLinkRouter = Router();

reviewLinkRouter.get("/:code", reviewLinkRateLimit, asyncHandler(async (req, res) => {
  res.json({ order: await getReviewRequestView(String(req.params.code)) });
}));
reviewLinkRouter.post("/:code", reviewLinkRateLimit, validate(linkReviewSchema), asyncHandler(async (req, res) => {
  const review = await submitReviewFromLink(String(req.params.code), req.body as LinkReviewInput);
  res.status(201).json({ review: { id: review.id, rating: review.rating, status: review.status } });
}));
