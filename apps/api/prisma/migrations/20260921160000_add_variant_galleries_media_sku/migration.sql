-- P3 of the catalog work: per-variant image galleries, image metadata, variant compare-at price and status,
-- and the storage behind the SKU generator.
--
-- Additive only. `ProductVariant.imageId` stays (it is the variant's primary image); each existing assignment is
-- copied into the new gallery table as that variant's first image, so nothing changes on the storefront.

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "caption" TEXT,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "ProductTypeDef" ADD COLUMN     "skuCode" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "compareAtPrice" DECIMAL(10,2),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "VariantImage" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VariantImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "skuPrefix" TEXT NOT NULL DEFAULT 'AZ',
    "skuPattern" TEXT NOT NULL DEFAULT '{PREFIX}-{TYPE}-{COLOR}-{SIZE}-{SEQ:3}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuCounter" (
    "scope" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SkuCounter_pkey" PRIMARY KEY ("scope")
);

-- CreateIndex
CREATE INDEX "VariantImage_imageId_idx" ON "VariantImage"("imageId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantImage_variantId_imageId_key" ON "VariantImage"("variantId", "imageId");

-- AddForeignKey
ALTER TABLE "VariantImage" ADD CONSTRAINT "VariantImage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantImage" ADD CONSTRAINT "VariantImage_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "ProductImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: a variant's existing image becomes the first entry of its gallery.
INSERT INTO "VariantImage" ("id", "variantId", "imageId", "sortOrder")
SELECT 'vi_' || md5(v."id" || v."imageId"), v."id", v."imageId", 0
FROM "ProductVariant" v
WHERE v."imageId" IS NOT NULL
ON CONFLICT ("variantId", "imageId") DO NOTHING;

-- Short SKU codes for the built-in types (admin-created types fall back to the first letters of their name).
UPDATE "ProductTypeDef" SET "skuCode" = CASE "key"
  WHEN 'CLOTHING' THEN 'CLO' WHEN 'FRAGRANCE' THEN 'FRG' WHEN 'ACCESSORY' THEN 'ACC' WHEN 'WATCH' THEN 'WAT'
  WHEN 'SHOES' THEN 'SHO' WHEN 'COSMETICS' THEN 'COS' WHEN 'ISLAMIC_PRODUCT' THEN 'ISL' WHEN 'HOME' THEN 'HOM'
END
WHERE "isSystem" = true AND "skuCode" IS NULL;
