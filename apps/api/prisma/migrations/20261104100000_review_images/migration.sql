-- Photo reviews: customer photos attached to a product review (shown once the review is approved).
ALTER TABLE "ProductReview" ADD COLUMN "images" TEXT[] DEFAULT ARRAY[]::TEXT[];
