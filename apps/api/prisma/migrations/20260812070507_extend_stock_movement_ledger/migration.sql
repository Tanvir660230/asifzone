-- AlterEnum
ALTER TYPE "StockMovementReason" ADD VALUE 'RETURN';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "adminId" TEXT,
ADD COLUMN     "note" TEXT;

-- CreateIndex
CREATE INDEX "StockMovement_reason_idx" ON "StockMovement"("reason");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
