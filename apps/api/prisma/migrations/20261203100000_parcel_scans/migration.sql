-- Order Operations phase 4: dispatch and return scanning. Additive: nullable columns on Order, a settings column with the
-- current behaviour as default (BOOKING), two new tables. Scans never write stock, money or order status.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "handedOverAt" TIMESTAMP(3),
ADD COLUMN     "handedOverBatchId" TEXT,
ADD COLUMN     "handedOverByAdminId" TEXT,
ADD COLUMN     "receivedBackAt" TIMESTAMP(3),
ADD COLUMN     "receivedBackBatchId" TEXT,
ADD COLUMN     "receivedBackByAdminId" TEXT,
ADD COLUMN     "returnInspectedAt" TIMESTAMP(3),
ADD COLUMN     "shippedSmsDeferred" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "shippedSmsTrigger" TEXT NOT NULL DEFAULT 'BOOKING';

-- CreateTable
CREATE TABLE "ParcelScanBatch" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdByAdminId" TEXT,
    "confirmedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "ParcelScanBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelScanEvent" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clientScanId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT,
    "result" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "discrepancy" BOOLEAN NOT NULL DEFAULT false,
    "adminId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParcelScanEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParcelScanBatch_kind_status_createdAt_idx" ON "ParcelScanBatch"("kind", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelScanEvent_clientScanId_key" ON "ParcelScanEvent"("clientScanId");

-- CreateIndex
CREATE INDEX "ParcelScanEvent_batchId_createdAt_idx" ON "ParcelScanEvent"("batchId", "createdAt");

-- CreateIndex
CREATE INDEX "ParcelScanEvent_orderId_kind_idx" ON "ParcelScanEvent"("orderId", "kind");

-- CreateIndex
CREATE INDEX "Order_handedOverAt_idx" ON "Order"("handedOverAt");

-- CreateIndex
CREATE INDEX "Order_receivedBackAt_idx" ON "Order"("receivedBackAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_handedOverByAdminId_fkey" FOREIGN KEY ("handedOverByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_receivedBackByAdminId_fkey" FOREIGN KEY ("receivedBackByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelScanBatch" ADD CONSTRAINT "ParcelScanBatch_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelScanEvent" ADD CONSTRAINT "ParcelScanEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ParcelScanBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelScanEvent" ADD CONSTRAINT "ParcelScanEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelScanEvent" ADD CONSTRAINT "ParcelScanEvent_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

