-- A cash-on-delivery order delivered for less than its total waits for a person's decision. Existing orders stay null.
ALTER TABLE "Order" ADD COLUMN "doorShortfallAt" TIMESTAMP(3),
  ADD COLUMN "doorDecision" TEXT,
  ADD COLUMN "doorDecidedAt" TIMESTAMP(3),
  ADD COLUMN "doorDecidedByAdminId" TEXT;

CREATE INDEX "Order_doorShortfallAt_idx" ON "Order"("doorShortfallAt") WHERE "doorShortfallAt" IS NOT NULL;
