-- Steadfast's reported collection on a partial delivery, and a log of every courier webhook (docs/PAYMENT_LEDGER.md §5b).
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "courierCollectedAmount" DECIMAL(10,2),
ADD COLUMN     "courierCollectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CourierWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'STEADFAST',
    "idempotencyKey" TEXT,
    "notificationType" TEXT NOT NULL,
    "consignmentId" TEXT,
    "orderId" TEXT,
    "status" TEXT,
    "codAmount" DECIMAL(10,2),
    "deliveryCharge" DECIMAL(10,2),
    "trackingMessage" TEXT,
    "payload" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourierWebhookEvent_idempotencyKey_key" ON "CourierWebhookEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CourierWebhookEvent_consignmentId_idx" ON "CourierWebhookEvent"("consignmentId");

-- CreateIndex
CREATE INDEX "CourierWebhookEvent_orderId_idx" ON "CourierWebhookEvent"("orderId");

-- CreateIndex
CREATE INDEX "CourierWebhookEvent_receivedAt_idx" ON "CourierWebhookEvent"("receivedAt");

