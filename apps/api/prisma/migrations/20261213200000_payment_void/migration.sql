-- A COD / manual payment entered by mistake can be cancelled (voidPayment): it then counts nowhere (payment position,
-- books, analytics), and the row stays with who cancelled it, when and why.
ALTER TYPE "PaymentTxnStatus" ADD VALUE 'VOIDED';

ALTER TABLE "Payment" ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedByAdminId" TEXT,
ADD COLUMN "voidReason" TEXT;
