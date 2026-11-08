-- Phase 9 (docs/PHASE_9_AUDIT.md D-4): courier booking claim. Additive, nullable; existing rows are unaffected.
ALTER TABLE "Order" ADD COLUMN "courierBookingStartedAt" TIMESTAMP(3);
