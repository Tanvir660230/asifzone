-- CreateEnum
CREATE TYPE "MaterialType" AS ENUM ('RAW', 'PACKAGING', 'CONSUMABLE');

-- AlterTable
ALTER TABLE "GoodsReceiptLine" ADD COLUMN     "discountAmount" DECIMAL(18,2),
ADD COLUMN     "grossUnitPrice" DECIMAL(18,6),
ADD COLUMN     "purchaseQty" DECIMAL(18,4),
ADD COLUMN     "purchaseUnitFactor" DECIMAL(14,4),
ADD COLUMN     "purchaseUnitId" TEXT,
ADD COLUMN     "purchaseUnitLabel" TEXT;

-- AlterTable
ALTER TABLE "MaterialPurchaseUnit" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "materialType" "MaterialType";

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "discountAmount" DECIMAL(18,2),
ADD COLUMN     "grossUnitPrice" DECIMAL(18,6),
ADD COLUMN     "purchaseQty" DECIMAL(18,4),
ADD COLUMN     "purchaseUnitFactor" DECIMAL(14,4),
ADD COLUMN     "purchaseUnitId" TEXT,
ADD COLUMN     "purchaseUnitLabel" TEXT;

-- AlterTable
ALTER TABLE "StockItemSetting" ADD COLUMN     "reorderPoint" INTEGER,
ADD COLUMN     "safetyStock" INTEGER;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseUnitId_fkey" FOREIGN KEY ("purchaseUnitId") REFERENCES "MaterialPurchaseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchaseUnitId_fkey" FOREIGN KEY ("purchaseUnitId") REFERENCES "MaterialPurchaseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- docs/MATERIALS_PURCHASING.md: a material type only on a material; reorder figures and purchase quantities never negative;
-- a purchase-unit snapshot is whole (label, size and quantity together) or absent.
ALTER TABLE "Product" ADD CONSTRAINT "Product_materialType_only_material" CHECK ("materialType" IS NULL OR "kind" = 'MATERIAL');
ALTER TABLE "StockItemSetting" ADD CONSTRAINT "StockItemSetting_reorder_nonneg" CHECK (("reorderPoint" IS NULL OR "reorderPoint" >= 0) AND ("safetyStock" IS NULL OR "safetyStock" >= 0));
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchase_unit_whole" CHECK (
  ("purchaseUnitLabel" IS NULL AND "purchaseUnitFactor" IS NULL AND "purchaseQty" IS NULL)
  OR ("purchaseUnitLabel" IS NOT NULL AND "purchaseUnitFactor" > 0 AND "purchaseQty" >= 0));
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchase_unit_whole" CHECK (
  ("purchaseUnitLabel" IS NULL AND "purchaseUnitFactor" IS NULL AND "purchaseQty" IS NULL)
  OR ("purchaseUnitLabel" IS NOT NULL AND "purchaseUnitFactor" > 0 AND "purchaseQty" > 0));
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_discount_nonneg" CHECK ("discountAmount" IS NULL OR "discountAmount" >= 0);
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_discount_nonneg" CHECK ("discountAmount" IS NULL OR "discountAmount" >= 0);
