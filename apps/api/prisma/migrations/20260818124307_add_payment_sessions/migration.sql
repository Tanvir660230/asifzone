-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('SSLCOMMERZ', 'EPS_PG');

-- CreateEnum
CREATE TYPE "PaymentSessionStatus" AS ENUM ('ACTIVE', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentTxnStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'COMPLETED');

-- AlterTable
ALTER TABLE "SmsNotificationSetting" ADD COLUMN     "customerPaymentConfirmedEmailEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PaymentSession" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "gatewayTransactionRef" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "gatewayUrl" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentSessionId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentTxnStatus" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "verifiedAmount" DECIMAL(10,2),
    "providerTransactionId" TEXT,
    "rawResponse" JSONB,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentSessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "method" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByAdminId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSession_gatewayTransactionRef_key" ON "PaymentSession"("gatewayTransactionRef");

-- CreateIndex
CREATE INDEX "PaymentSession_orderId_idx" ON "PaymentSession"("orderId");

-- CreateIndex
CREATE INDEX "PaymentSession_status_provider_createdAt_idx" ON "PaymentSession"("status", "provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentSessionId_key" ON "Payment"("paymentSessionId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentSessionId_idx" ON "PaymentEvent"("paymentSessionId");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- AddForeignKey
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentSessionId_fkey" FOREIGN KEY ("paymentSessionId") REFERENCES "PaymentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentSessionId_fkey" FOREIGN KEY ("paymentSessionId") REFERENCES "PaymentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedByAdminId_fkey" FOREIGN KEY ("requestedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The service layer (payment.service.ts's startPaymentSession/retryPayment) already checks for an
-- existing ACTIVE session before creating a new one, but that check-then-create isn't atomic — two
-- near-simultaneous calls for the same order (retry double-click, a checkout retry racing the
-- reconciliation sweep) can both pass the check and both insert. This partial unique index is the
-- real backstop — Prisma's schema DSL can't express a partial/conditional unique constraint, so it
-- exists only as raw SQL (see the comment on PaymentSession in schema.prisma), same pattern as
-- Address's one-default-per-customer and ReturnRequest's one-pending-per-order.
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentSession_orderId_active_key" ON "PaymentSession" ("orderId") WHERE "status" = 'ACTIVE';
