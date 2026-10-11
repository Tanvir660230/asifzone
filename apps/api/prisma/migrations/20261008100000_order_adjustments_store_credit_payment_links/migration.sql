-- Order adjustments (docs/ORDER_ADJUSTMENTS.md): product free delivery, order modifications, the customer store-credit
-- ledger, payment links, per-session gateway amounts, item-level return records. Additive only: no existing row is
-- rewritten. New enum values are not used in this migration (PostgreSQL can't use a value in the transaction that adds it).

-- CreateEnum
CREATE TYPE "CustomerCreditType" AS ENUM ('CANCELLATION', 'ORDER_MODIFICATION', 'RETURN', 'EXCHANGE', 'REFUND_TO_CREDIT', 'ORDER_PAYMENT', 'ORDER_PAYMENT_RELEASED');

-- CreateEnum
CREATE TYPE "OrderModificationStatus" AS ENUM ('APPLIED', 'AWAITING_PAYMENT', 'SUPERSEDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderEditorType" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentLinkPurpose" AS ENUM ('ORDER_BALANCE', 'MODIFICATION');

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'STORE_CREDIT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_PAID';
ALTER TYPE "PaymentStatus" ADD VALUE 'CREDITED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "freeDeliverySnapshot" BOOLEAN;

-- AlterTable
ALTER TABLE "PaymentSession" ADD COLUMN     "amount" DECIMAL(10,2),
ADD COLUMN     "orderModificationId" TEXT,
ADD COLUMN     "paymentLinkId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "freeDelivery" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "compensation" TEXT,
ADD COLUMN     "compensationAmount" DECIMAL(10,2),
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "lines" JSONB;

-- CreateTable
CREATE TABLE "CustomerCreditEntry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "CustomerCreditType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "orderId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "paymentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderModification" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "OrderModificationStatus" NOT NULL,
    "initiatedBy" "OrderEditorType" NOT NULL,
    "customerId" TEXT,
    "adminId" TEXT,
    "reason" TEXT,
    "baseRevision" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "plan" JSONB NOT NULL,
    "previousTotal" DECIMAL(10,2) NOT NULL,
    "newTotal" DECIMAL(10,2) NOT NULL,
    "amountDue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "amountCredited" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderModification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "purpose" "PaymentLinkPurpose" NOT NULL,
    "orderModificationId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "orderRevision" INTEGER NOT NULL,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "cancelledByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCreditEntry_paymentId_key" ON "CustomerCreditEntry"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCreditEntry_idempotencyKey_key" ON "CustomerCreditEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_customerId_createdAt_idx" ON "CustomerCreditEntry"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_orderId_idx" ON "CustomerCreditEntry"("orderId");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_sourceType_sourceId_idx" ON "CustomerCreditEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderModification_idempotencyKey_key" ON "OrderModification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderModification_orderId_status_idx" ON "OrderModification"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderModification_orderId_sequence_key" ON "OrderModification"("orderId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_tokenHash_key" ON "PaymentLink"("tokenHash");

-- CreateIndex
CREATE INDEX "PaymentLink_orderId_status_idx" ON "PaymentLink"("orderId", "status");

-- CreateIndex
CREATE INDEX "PaymentSession_paymentLinkId_idx" ON "PaymentSession"("paymentLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_idempotencyKey_key" ON "ReturnRequest"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_orderModificationId_fkey" FOREIGN KEY ("orderModificationId") REFERENCES "OrderModification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderModification" ADD CONSTRAINT "OrderModification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderModification" ADD CONSTRAINT "OrderModification_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_orderModificationId_fkey" FOREIGN KEY ("orderModificationId") REFERENCES "OrderModification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_cancelledByAdminId_fkey" FOREIGN KEY ("cancelledByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- At most one ACTIVE payment link per order, and one modification waiting for payment per order (Prisma can't express
-- partial unique indexes — same pattern as PaymentSession's one-ACTIVE-session index).
CREATE UNIQUE INDEX "PaymentLink_one_active_per_order" ON "PaymentLink"("orderId") WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX "OrderModification_one_awaiting_payment_per_order" ON "OrderModification"("orderId") WHERE status = 'AWAITING_PAYMENT';

-- Store-credit ledger integrity: spending is the only negative entry type, every other entry adds balance; no zero rows.
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_amount_sign" CHECK (
  (type = 'ORDER_PAYMENT' AND amount < 0) OR (type <> 'ORDER_PAYMENT' AND amount > 0)
);

-- Append-only money: an entry's customer, type, amount and currency never change (linking a reserved spend to the
-- order/payment it became is the only update the service makes).
CREATE OR REPLACE FUNCTION customer_credit_entry_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."customerId" IS DISTINCT FROM OLD."customerId" OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" THEN
    RAISE EXCEPTION 'CustomerCreditEntry is append-only (customer, type, amount, currency and key never change)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customer_credit_entry_immutable BEFORE UPDATE ON "CustomerCreditEntry"
  FOR EACH ROW EXECUTE FUNCTION customer_credit_entry_immutable();
