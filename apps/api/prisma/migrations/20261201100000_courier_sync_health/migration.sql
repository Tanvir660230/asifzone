-- Order Operations Phase 0: courier status polling by schedule, and the evidence that the Steadfast webhook works.
-- Additive only: one nullable Order column, one nullable CourierWebhookEvent column, two new tables. Nothing is backfilled —
-- a NULL courierNextPollAt means "due now", so every open parcel is checked on the first run, exactly as today.

ALTER TABLE "Order" ADD COLUMN "courierNextPollAt" TIMESTAMP(3);
CREATE INDEX "Order_courierNextPollAt_idx" ON "Order"("courierNextPollAt");

-- What Steadfast's status API answered when the webhook was verified (the body's own claim stays in "status").
ALTER TABLE "CourierWebhookEvent" ADD COLUMN "verifiedStatus" TEXT;

-- A webhook call refused at the token check: when and why only — never the token, a header or the body.
CREATE TABLE "CourierWebhookRejection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'STEADFAST',
    "reason" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourierWebhookRejection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CourierWebhookRejection_receivedAt_idx" ON "CourierWebhookRejection"("receivedAt");

-- Each change of a parcel's courier status and how we learned of it (WEBHOOK, POLL, ON_DEMAND).
CREATE TABLE "CourierStatusChange" (
    "id" TEXT NOT NULL,
    "consignmentId" TEXT NOT NULL,
    "orderId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourierStatusChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CourierStatusChange_observedAt_idx" ON "CourierStatusChange"("observedAt");
CREATE INDEX "CourierStatusChange_consignmentId_idx" ON "CourierStatusChange"("consignmentId");
