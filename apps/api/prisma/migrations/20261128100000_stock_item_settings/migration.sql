-- Smart stock page (docs/STOCK_HUB.md §7): per-item usual supplier, days to arrive and days a reorder covers. Additive.
-- CreateTable
CREATE TABLE "StockItemSetting" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "preferredSupplierId" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 3,
    "coverDays" INTEGER NOT NULL DEFAULT 30,
    "updatedByAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockItemSetting_variantId_key" ON "StockItemSetting"("variantId");

-- AddForeignKey
ALTER TABLE "StockItemSetting" ADD CONSTRAINT "StockItemSetting_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItemSetting" ADD CONSTRAINT "StockItemSetting_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

