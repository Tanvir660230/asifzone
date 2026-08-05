-- AlterTable
ALTER TABLE "StoreSetting" DROP COLUMN "shippingFlatFee",
ADD COLUMN     "shippingFeeDhaka" DECIMAL(10,2) NOT NULL DEFAULT 60,
ADD COLUMN     "shippingFeeOutsideDhaka" DECIMAL(10,2) NOT NULL DEFAULT 120;
