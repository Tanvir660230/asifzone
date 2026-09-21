-- P4 of the catalog work: configurable product-page sections (global / template / product overrides), product FAQs
-- and hand-picked related products.
--
-- Additive and data-free: nothing is seeded or backfilled. With no rows the storefront resolves every section from
-- the code defaults, which reproduce the previous page exactly, and every recommendation list falls back to the
-- existing algorithm.

-- CreateEnum
CREATE TYPE "ProductRelationKind" AS ENUM ('RELATED', 'CROSS_SELL', 'UPSELL', 'FREQUENTLY_BOUGHT', 'RECOMMENDED');

-- CreateTable
CREATE TABLE "GlobalSection" (
    "sectionKey" TEXT NOT NULL,
    "enabled" BOOLEAN,
    "sortOrder" INTEGER,
    "title" TEXT,
    "content" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalSection_pkey" PRIMARY KEY ("sectionKey")
);

-- CreateTable
CREATE TABLE "TemplateSection" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "enabled" BOOLEAN,
    "sortOrder" INTEGER,
    "title" TEXT,
    "content" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSection" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "enabled" BOOLEAN,
    "sortOrder" INTEGER,
    "title" TEXT,
    "content" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFaq" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductFaq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRelation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "relatedId" TEXT NOT NULL,
    "kind" "ProductRelationKind" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSection_templateId_sectionKey_key" ON "TemplateSection"("templateId", "sectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSection_productId_sectionKey_key" ON "ProductSection"("productId", "sectionKey");

-- CreateIndex
CREATE INDEX "ProductFaq_productId_sortOrder_idx" ON "ProductFaq"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductRelation_productId_kind_sortOrder_idx" ON "ProductRelation"("productId", "kind", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductRelation_relatedId_idx" ON "ProductRelation"("relatedId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRelation_productId_relatedId_kind_key" ON "ProductRelation"("productId", "relatedId", "kind");

-- AddForeignKey
ALTER TABLE "TemplateSection" ADD CONSTRAINT "TemplateSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProductTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSection" ADD CONSTRAINT "ProductSection_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFaq" ADD CONSTRAINT "ProductFaq_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelation" ADD CONSTRAINT "ProductRelation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelation" ADD CONSTRAINT "ProductRelation_relatedId_fkey" FOREIGN KEY ("relatedId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A product can't be listed as its own recommendation.
ALTER TABLE "ProductRelation" ADD CONSTRAINT "ProductRelation_not_self_check" CHECK ("productId" <> "relatedId");
