-- Unified scanner (docs/ORDER_OPERATIONS.md "Receive and inspect"): how a scan resolved, codes tied to orders by hand, and
-- the audit record of each physical receipt. Additive only.

ALTER TABLE "ParcelScanEvent" ADD COLUMN "resolvedBy" TEXT;

CREATE TABLE "ParcelCodeAlias" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParcelCodeAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ParcelReceipt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "adminId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'RECEIPT',
    "code" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "outcome" TEXT,
    "statusBefore" "OrderStatus" NOT NULL,
    "statusAfter" "OrderStatus" NOT NULL,
    "lines" JSONB NOT NULL,
    "expectedCod" DECIMAL(10,2),
    "actualCollected" DECIMAL(10,2),
    "courierCharge" DECIMAL(10,2),
    "reason" TEXT,
    "note" TEXT,
    "paymentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correctsReceiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParcelReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParcelCodeAlias_code_key" ON "ParcelCodeAlias"("code");
CREATE INDEX "ParcelCodeAlias_orderId_idx" ON "ParcelCodeAlias"("orderId");
CREATE UNIQUE INDEX "ParcelReceipt_idempotencyKey_key" ON "ParcelReceipt"("idempotencyKey");
CREATE INDEX "ParcelReceipt_orderId_createdAt_idx" ON "ParcelReceipt"("orderId", "createdAt");

-- Scanning resolves Steadfast's QR (the tracking link) and product barcodes by exact match.
CREATE INDEX "Order_courierTrackingLink_idx" ON "Order"("courierTrackingLink");
CREATE INDEX "ProductVariant_barcode_idx" ON "ProductVariant"("barcode");

ALTER TABLE "ParcelCodeAlias" ADD CONSTRAINT "ParcelCodeAlias_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParcelCodeAlias" ADD CONSTRAINT "ParcelCodeAlias_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParcelReceipt" ADD CONSTRAINT "ParcelReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParcelReceipt" ADD CONSTRAINT "ParcelReceipt_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParcelReceipt" ADD CONSTRAINT "ParcelReceipt_correctsReceiptId_fkey" FOREIGN KEY ("correctsReceiptId") REFERENCES "ParcelReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
