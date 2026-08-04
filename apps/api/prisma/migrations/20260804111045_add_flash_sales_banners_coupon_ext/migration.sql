-- CreateEnum
CREATE TYPE "BannerPlacement" AS ENUM ('HERO_CAROUSEL', 'PROMO_STRIP');

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "maxDiscountAmount" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "FlashSale" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "bannerImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlashSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlashSaleItem" (
    "id" TEXT NOT NULL,
    "flashSaleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "discountType" "CouponType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "stockLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlashSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL,
    "placement" "BannerPlacement" NOT NULL DEFAULT 'HERO_CAROUSEL',
    "imageUrl" TEXT NOT NULL,
    "mobileImageUrl" TEXT,
    "linkUrl" TEXT,
    "title" TEXT,
    "subtitle" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlashSale_isActive_startsAt_endsAt_idx" ON "FlashSale"("isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "FlashSaleItem_productId_idx" ON "FlashSaleItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "FlashSaleItem_flashSaleId_productId_key" ON "FlashSaleItem"("flashSaleId", "productId");

-- CreateIndex
CREATE INDEX "Banner_placement_isActive_idx" ON "Banner"("placement", "isActive");

-- AddForeignKey
ALTER TABLE "FlashSaleItem" ADD CONSTRAINT "FlashSaleItem_flashSaleId_fkey" FOREIGN KEY ("flashSaleId") REFERENCES "FlashSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashSaleItem" ADD CONSTRAINT "FlashSaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
