-- CreateEnum
CREATE TYPE "HomepageSectionType" AS ENUM ('HERO', 'TRUST_STRIP', 'PERSONALIZED_LEAD', 'PRODUCT_CAROUSEL', 'FLASH_SALE', 'CATEGORY_GRID', 'BRAND_STORY', 'VALUES_GRID', 'SMART_RECOMMENDATIONS', 'PROMO_BANNER');

-- CreateTable
CREATE TABLE "HomepageSection" (
    "id" TEXT NOT NULL,
    "type" "HomepageSectionType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomepageSection_isActive_sortOrder_idx" ON "HomepageSection"("isActive", "sortOrder");
