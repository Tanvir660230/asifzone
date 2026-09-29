-- Phase 3 (docs/STOREFRONT_READ_MODEL.md): storefront read model. ADDITIVE ONLY — one new projection table; no
-- existing table or column is touched.

-- CreateTable
CREATE TABLE "ProductReadModel" (
    "productId" TEXT NOT NULL,
    "minSellingPrice" DECIMAL(10,2) NOT NULL,
    "maxSellingPrice" DECIMAL(10,2) NOT NULL,
    "listPriceOfMin" DECIMAL(10,2) NOT NULL,
    "hasLiveFlashSale" BOOLEAN NOT NULL,
    "currency" TEXT NOT NULL,
    "pricingVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "volatile" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReadModel_pkey" PRIMARY KEY ("productId")
);

-- CreateIndex
CREATE INDEX "ProductReadModel_minSellingPrice_idx" ON "ProductReadModel"("minSellingPrice");
CREATE INDEX "ProductReadModel_validUntil_idx" ON "ProductReadModel"("validUntil");
CREATE INDEX "ProductReadModel_volatile_idx" ON "ProductReadModel"("volatile");

-- AddForeignKey
ALTER TABLE "ProductReadModel" ADD CONSTRAINT "ProductReadModel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No SQL backfill: the price comes from the canonical pricing engine (TypeScript), and re-implementing it in SQL would
-- be a second pricing algorithm. Rows are created by the rebuild (`pnpm --filter api read-model:rebuild`, run after
-- deploy), and in any case by the read-time freshness guard, which projects every missing row before a listing,
-- facet or recommendation query uses the table (docs/STOREFRONT_READ_MODEL.md §3).
--
-- Verification (after the rebuild):
--   SELECT count(*) FROM "Product" p LEFT JOIN "ProductReadModel" r ON r."productId" = p.id
--    WHERE p."isActive" AND p."deletedAt" IS NULL AND r."productId" IS NULL;           -- 0
--   GET /api/v1/storefront/read-model/drift  (admin)                                       -- { drift: [] }
