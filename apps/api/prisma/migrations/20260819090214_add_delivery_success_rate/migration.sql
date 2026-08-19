-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "deliveryCancelledParcels" INTEGER,
ADD COLUMN     "deliveryScoreCheckedAt" TIMESTAMP(3),
ADD COLUMN     "deliverySuccessParcels" INTEGER,
ADD COLUMN     "deliverySuccessRate" DOUBLE PRECISION,
ADD COLUMN     "deliveryTotalParcels" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "courierStatusSyncedAt" TIMESTAMP(3),
ADD COLUMN     "courierSyncError" TEXT;
