-- Fixed-asset disposal proceeds come in through a Treasury deposit (docs/FINANCE_FIXED_ASSETS.md)

-- AlterTable
ALTER TABLE "FixedAsset" ADD COLUMN     "disposalMovementId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_disposalMovementId_key" ON "FixedAsset"("disposalMovementId");

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_disposalMovementId_fkey" FOREIGN KEY ("disposalMovementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

