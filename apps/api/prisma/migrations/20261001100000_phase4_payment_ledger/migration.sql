-- Phase 4 (docs/PAYMENT_LEDGER.md): payment ledger. ADDITIVE ONLY — new enum values, nullable/defaulted columns, two
-- unique indexes and two SET NULL foreign keys. No data is changed here; the backfill is the next migration (a new enum
-- value can't be used in the transaction that adds it).

-- AlterEnum: COD collected on delivery and staff-recorded MANUAL payments become ledger rows.
ALTER TYPE "PaymentProvider" ADD VALUE 'COD';
ALTER TYPE "PaymentProvider" ADD VALUE 'MANUAL';

-- AlterEnum: partial refunds (planned as M8 since Phase 0).
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterTable: COD/manual settlements have no gateway session (the unique index on paymentSessionId stays).
ALTER TABLE "Payment" ADD COLUMN     "backfilled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "recordedByAdminId" TEXT,
ALTER COLUMN "paymentSessionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "completedByAdminId" TEXT,
ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedByAdminId_fkey" FOREIGN KEY ("recordedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_completedByAdminId_fkey" FOREIGN KEY ("completedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
