-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "bundleDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "bundleId" TEXT;

-- CreateTable
CREATE TABLE "Bundle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "anchorCategoryId" TEXT NOT NULL,
    "discountType" "CouponType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "minSuggestedCategories" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleSuggestion" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BundleSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bundle_anchorCategoryId_isActive_idx" ON "Bundle"("anchorCategoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BundleSuggestion_bundleId_categoryId_key" ON "BundleSuggestion"("bundleId", "categoryId");

-- AddForeignKey
ALTER TABLE "Bundle" ADD CONSTRAINT "Bundle_anchorCategoryId_fkey" FOREIGN KEY ("anchorCategoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleSuggestion" ADD CONSTRAINT "BundleSuggestion_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleSuggestion" ADD CONSTRAINT "BundleSuggestion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
