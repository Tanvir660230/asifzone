-- Order hold (docs/ORDER_HOLD.md): a customer-requested wait on a PENDING/CONFIRMED order, and one row per hold.
ALTER TABLE "Order" ADD COLUMN "holdUntil" TIMESTAMP(3),
ADD COLUMN "holdReason" TEXT,
ADD COLUMN "holdNote" TEXT,
ADD COLUMN "holdStartedAt" TIMESTAMP(3),
ADD COLUMN "holdStockReleased" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "holdCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Order_holdUntil_idx" ON "Order"("holdUntil");

CREATE TABLE "OrderHold" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "until" TIMESTAMP(3) NOT NULL,
    "stockReleased" BOOLEAN NOT NULL DEFAULT false,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "outcome" TEXT,

    CONSTRAINT "OrderHold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderHold_orderId_idx" ON "OrderHold"("orderId");
CREATE INDEX "OrderHold_startedAt_idx" ON "OrderHold"("startedAt");

ALTER TABLE "OrderHold" ADD CONSTRAINT "OrderHold_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
