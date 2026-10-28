-- Owner decision Q-F (blueprint P1.4): owner-advance subledger. Additive: two new tables; no existing row changes.
CREATE TABLE "OwnerAdvance" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fundingMovementId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "advanceDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerAdvance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OwnerAdvanceAllocation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "repaymentMovementId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerAdvanceAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OwnerAdvance_fundingMovementId_key" ON "OwnerAdvance"("fundingMovementId");
CREATE INDEX "OwnerAdvance_businessId_advanceDate_idx" ON "OwnerAdvance"("businessId", "advanceDate");
CREATE INDEX "OwnerAdvance_sourceType_sourceId_idx" ON "OwnerAdvance"("sourceType", "sourceId");
CREATE INDEX "OwnerAdvanceAllocation_advanceId_idx" ON "OwnerAdvanceAllocation"("advanceId");
CREATE UNIQUE INDEX "OwnerAdvanceAllocation_repaymentMovementId_advanceId_key" ON "OwnerAdvanceAllocation"("repaymentMovementId", "advanceId");

ALTER TABLE "OwnerAdvance" ADD CONSTRAINT "OwnerAdvance_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnerAdvance" ADD CONSTRAINT "OwnerAdvance_fundingMovementId_fkey" FOREIGN KEY ("fundingMovementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnerAdvanceAllocation" ADD CONSTRAINT "OwnerAdvanceAllocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnerAdvanceAllocation" ADD CONSTRAINT "OwnerAdvanceAllocation_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "OwnerAdvance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnerAdvanceAllocation" ADD CONSTRAINT "OwnerAdvanceAllocation_repaymentMovementId_fkey" FOREIGN KEY ("repaymentMovementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
