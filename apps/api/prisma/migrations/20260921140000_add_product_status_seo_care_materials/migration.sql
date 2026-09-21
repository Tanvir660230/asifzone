-- P2 of the catalog work: product status (draft -> ready -> published -> unpublished), SEO fields,
-- reusable care guides, materials with composition, and per-template publish requirements.
--
-- Additive only. `Product.isActive` stays and is kept equal to `status = 'PUBLISHED'` by the service, so every
-- existing storefront query keeps working. Existing rows: active -> PUBLISHED (the column default),
-- inactive -> UNPUBLISHED.

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'READY', 'PUBLISHED', 'UNPUBLISHED');

-- DropIndex
DROP INDEX "Product_typeId_idx";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "careOverride" JSONB,
ADD COLUMN     "carePresetId" TEXT,
ADD COLUMN     "focusKeyword" TEXT,
ADD COLUMN     "ogDescription" TEXT,
ADD COLUMN     "ogImageUrl" TEXT,
ADD COLUMN     "ogTitle" TEXT,
ADD COLUMN     "status" "ProductStatus" NOT NULL DEFAULT 'PUBLISHED';

-- AlterTable
ALTER TABLE "ProductTemplate" ADD COLUMN     "carePresetId" TEXT,
ADD COLUMN     "requiredChecks" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CareGuidePreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "steps" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareGuidePreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMaterial" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "materialId" TEXT,
    "customName" TEXT,
    "percentage" DECIMAL(5,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareGuidePreset_name_key" ON "CareGuidePreset"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Material_name_key" ON "Material"("name");

-- CreateIndex
CREATE INDEX "ProductMaterial_productId_idx" ON "ProductMaterial"("productId");

-- CreateIndex
CREATE INDEX "ProductMaterial_materialId_idx" ON "ProductMaterial"("materialId");

-- CreateIndex
CREATE INDEX "Product_typeId_status_idx" ON "Product"("typeId", "status");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "Product_carePresetId_idx" ON "Product"("carePresetId");

-- CreateIndex
CREATE INDEX "ProductTemplate_carePresetId_idx" ON "ProductTemplate"("carePresetId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_carePresetId_fkey" FOREIGN KEY ("carePresetId") REFERENCES "CareGuidePreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTemplate" ADD CONSTRAINT "ProductTemplate_carePresetId_fkey" FOREIGN KEY ("carePresetId") REFERENCES "CareGuidePreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMaterial" ADD CONSTRAINT "ProductMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMaterial" ADD CONSTRAINT "ProductMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A composition line must name a material (catalog or custom) and, when given, a sane percentage.
ALTER TABLE "ProductMaterial" ADD CONSTRAINT "ProductMaterial_name_check" CHECK ("materialId" IS NOT NULL OR "customName" IS NOT NULL);
ALTER TABLE "ProductMaterial" ADD CONSTRAINT "ProductMaterial_percentage_check" CHECK ("percentage" IS NULL OR ("percentage" > 0 AND "percentage" <= 100));

-- Backfill: the default already made every existing row PUBLISHED; inactive ones were not live.
UPDATE "Product" SET "status" = 'UNPUBLISHED' WHERE "isActive" = false;
