-- Door-swap outcomes (phase B): called-off exchanges, when/why an outcome was set, the order a "kept both" became.
ALTER TYPE "SwapStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "ReturnRequest" ADD COLUMN "swapSettledAt" TIMESTAMP(3),
ADD COLUMN "swapNote" TEXT,
ADD COLUMN "keptOrderId" TEXT;
