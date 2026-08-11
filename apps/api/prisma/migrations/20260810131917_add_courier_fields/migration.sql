-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "courierBookedAt" TIMESTAMP(3),
ADD COLUMN     "courierConsignmentId" TEXT,
ADD COLUMN     "courierStatus" TEXT;

-- CreateIndex
CREATE INDEX "Order_courierConsignmentId_idx" ON "Order"("courierConsignmentId");
