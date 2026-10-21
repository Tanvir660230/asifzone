-- Owner's books: courier claims for lost parcels (§3.5); a landed cost can be cancelled (§7.1).

-- CreateEnum
CREATE TYPE "CourierClaimStatus" AS ENUM ('OPEN', 'SETTLED');

-- AlterTable
ALTER TABLE "LandedCost" ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedByAdminId" TEXT;

-- CreateTable
CREATE TABLE "CourierClaim" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "consignmentId" TEXT,
    "claimDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CourierClaimStatus" NOT NULL DEFAULT 'OPEN',
    "settlements" JSONB NOT NULL DEFAULT '[]',
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierClaim_orderId_idx" ON "CourierClaim"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierClaim_businessId_number_key" ON "CourierClaim"("businessId", "number");

-- AddForeignKey
ALTER TABLE "CourierClaim" ADD CONSTRAINT "CourierClaim_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "CourierClaim" ADD CONSTRAINT "CourierClaim_values" CHECK ("amount" > 0 AND length(btrim("reason")) > 0 AND jsonb_typeof("settlements") = 'array');
CREATE TRIGGER "CourierClaim_no_truncate" BEFORE TRUNCATE ON "CourierClaim" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();

-- A landed cost is history; the only change it ever takes is being cancelled once.
CREATE OR REPLACE FUNCTION finance_landed_cost_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' AND OLD."reversedAt" IS NULL AND NEW."reversedAt" IS NOT NULL
     AND (NEW."businessId", NEW.number, NEW."costDate", NEW.description, NEW.payee, NEW.method, NEW.amount, NEW."goodsReceiptIds", NEW.allocations, NEW."movementId")
         IS NOT DISTINCT FROM (OLD."businessId", OLD.number, OLD."costDate", OLD.description, OLD.payee, OLD.method, OLD.amount, OLD."goodsReceiptIds", OLD.allocations, OLD."movementId") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: a landed cost is history (it can only be cancelled, once)' USING ERRCODE = 'check_violation';
END $$;
