-- CreateEnum
CREATE TYPE "CourierLossReason" AS ENUM ('CANCELLED_POST_BOOKING', 'PARTIAL_RETURN');

-- CreateEnum
CREATE TYPE "ReturnRequestType" AS ENUM ('RETURN', 'EXCHANGE');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_DELIVERED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "partialDeliveryReconciledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "returnedQuantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "exchangeOrderId" TEXT,
ADD COLUMN     "orderItemId" TEXT,
ADD COLUMN     "originalColorSnapshot" TEXT,
ADD COLUMN     "originalSizeSnapshot" TEXT,
ADD COLUMN     "requestedColorSnapshot" TEXT,
ADD COLUMN     "requestedSizeSnapshot" TEXT,
ADD COLUMN     "requestedVariantId" TEXT,
ADD COLUMN     "type" "ReturnRequestType" NOT NULL DEFAULT 'RETURN';

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "courierReturnFeeDhaka" DECIMAL(10,2) NOT NULL DEFAULT 60,
ADD COLUMN     "courierReturnFeeOutsideDhaka" DECIMAL(10,2) NOT NULL DEFAULT 120;

-- CreateTable
CREATE TABLE "CourierLossEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" "CourierLossReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierLossEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierLossEvent_orderId_idx" ON "CourierLossEvent"("orderId");

-- CreateIndex
CREATE INDEX "CourierLossEvent_createdAt_idx" ON "CourierLossEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_exchangeOrderId_fkey" FOREIGN KEY ("exchangeOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierLossEvent" ADD CONSTRAINT "CourierLossEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
