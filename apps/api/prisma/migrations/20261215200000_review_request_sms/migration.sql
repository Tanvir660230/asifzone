-- Two days after delivery, one SMS asks the customer for a review (modules/reviews/review-request.ts). Off by default.
ALTER TABLE "SmsNotificationSetting" ADD COLUMN "customerReviewRequestEnabled" BOOLEAN NOT NULL DEFAULT false;
-- When that SMS went out: set once (claimed before sending), so an order is never asked twice.
ALTER TABLE "Order" ADD COLUMN "reviewRequestedAt" TIMESTAMP(3);
