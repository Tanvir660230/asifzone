-- Smart stock page (docs/STOCK_HUB.md §7): a count loss by staff at or above the threshold waits for the owner. Additive.
-- CreateEnum
CREATE TYPE "StockCountApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "FinanceBusiness" ADD COLUMN     "countLossApprovalThreshold" DECIMAL(18,2) NOT NULL DEFAULT 1000;

-- CreateTable
CREATE TABLE "StockCountApproval" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "difference" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "value" DECIMAL(18,2),
    "status" "StockCountApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByAdminId" TEXT,
    "decidedByAdminId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "movementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCountApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockCountApproval_stockCountId_key" ON "StockCountApproval"("stockCountId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountApproval_movementId_key" ON "StockCountApproval"("movementId");

-- CreateIndex
CREATE INDEX "StockCountApproval_businessId_status_idx" ON "StockCountApproval"("businessId", "status");

-- AddForeignKey
ALTER TABLE "StockCountApproval" ADD CONSTRAINT "StockCountApproval_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountApproval" ADD CONSTRAINT "StockCountApproval_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "StockCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountApproval" ADD CONSTRAINT "StockCountApproval_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

