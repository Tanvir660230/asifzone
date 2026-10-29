-- Order Operations phase 3: customer confirmation calls. Additive: new nullable/defaulted columns, a new table, settings
-- with the plan's defaults. No backfill — earlier calls stay in Order.callAttempts and the status timeline.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "confirmationAssigneeId" TEXT,
ADD COLUMN     "confirmationClaimedAt" TIMESTAMP(3),
ADD COLUMN     "confirmationClaimedById" TEXT,
ADD COLUMN     "confirmationEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "confirmationEscalationReason" TEXT,
ADD COLUMN     "confirmationExtraAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "confirmationReprieveUntil" TIMESTAMP(3),
ADD COLUMN     "confirmationUnreached" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "confirmationEscalateHours" INTEGER NOT NULL DEFAULT 72,
ADD COLUMN     "confirmationMaxUnreached" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "confirmationNextDayHour" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "confirmationRetryMinutes" INTEGER NOT NULL DEFAULT 120;

-- CreateTable
CREATE TABLE "OrderConfirmationAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "adminId" TEXT,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "callbackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderConfirmationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderConfirmationAttempt_orderId_createdAt_idx" ON "OrderConfirmationAttempt"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_confirmationEscalatedAt_idx" ON "Order"("confirmationEscalatedAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_confirmationAssigneeId_fkey" FOREIGN KEY ("confirmationAssigneeId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_confirmationClaimedById_fkey" FOREIGN KEY ("confirmationClaimedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderConfirmationAttempt" ADD CONSTRAINT "OrderConfirmationAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderConfirmationAttempt" ADD CONSTRAINT "OrderConfirmationAttempt_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Append-only: an attempt is never edited or removed while its order exists. The one allowed change is the database's own
-- ON DELETE SET NULL when the admin who made the call is removed; a permanently deleted order takes its calls with it.
CREATE OR REPLACE FUNCTION order_confirmation_attempt_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."adminId" IS NULL AND OLD."adminId" IS NOT NULL
       AND NEW."id" = OLD."id" AND NEW."orderId" = OLD."orderId" AND NEW."outcome" = OLD."outcome"
       AND NEW."note" IS NOT DISTINCT FROM OLD."note" AND NEW."callbackAt" IS NOT DISTINCT FROM OLD."callbackAt"
       AND NEW."createdAt" = OLD."createdAt" THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'OrderConfirmationAttempt is append-only' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "Order" WHERE "id" = OLD."orderId") THEN
    RAISE EXCEPTION 'OrderConfirmationAttempt is append-only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrderConfirmationAttempt_append_only" BEFORE UPDATE OR DELETE ON "OrderConfirmationAttempt"
FOR EACH ROW EXECUTE FUNCTION order_confirmation_attempt_append_only();
