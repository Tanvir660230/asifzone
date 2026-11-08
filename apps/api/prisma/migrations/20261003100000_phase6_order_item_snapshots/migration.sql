-- Phase 6 (docs/PHASE_6_AUDIT.md): historical order-line facts. Additive, nullable columns; no FKs (history outlives
-- the catalog). Cost, category and brand are NOT backfilled — today's catalog is not history, so older lines stay
-- explicitly unknown ("not recorded"). productIdSnapshot is backfilled from the variant's product: a variant never
-- changes product, so that is the true historical fact.
ALTER TABLE "OrderItem" ADD COLUMN "unitCostSnapshot" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "productIdSnapshot" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "categoryIdSnapshot" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "categoryNameSnapshot" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "brandSnapshot" TEXT;

UPDATE "OrderItem" oi
SET "productIdSnapshot" = pv."productId"
FROM "ProductVariant" pv
WHERE pv."id" = oi."variantId" AND oi."productIdSnapshot" IS NULL;
