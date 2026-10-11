-- Phase 12 (docs/PHASE_12_IMPLEMENTATION_CONTRACT.md §17, D-1/D-2/D-8): store identity fields on the existing identity
-- owner (StoreSetting — no new StoreProfile table) and a neutral SKU-prefix default for NEW databases.
-- ADDITIVE ONLY: eight nullable columns, no backfill, no row written. The default change affects only rows created
-- later; the existing CatalogSetting row keeps its stored prefix, and no existing SKU is touched.

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "addressCity" TEXT,
ADD COLUMN     "addressRegion" TEXT,
ADD COLUMN     "addressPostalCode" TEXT,
ADD COLUMN     "addressCountry" TEXT,
ADD COLUMN     "legalJurisdiction" TEXT,
ADD COLUMN     "supportHours" TEXT;

-- AlterTable
ALTER TABLE "CatalogSetting" ALTER COLUMN "skuPrefix" SET DEFAULT 'SKU';
