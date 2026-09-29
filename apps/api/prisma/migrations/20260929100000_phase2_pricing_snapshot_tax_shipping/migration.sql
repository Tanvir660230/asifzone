-- Phase 2 (docs/PRICING_INVARIANTS.md): canonical pricing — tax configuration (D3, D10), shipping zones, order
-- pricing snapshots incl. flash-sale attribution (D4), coupon release (D7), idempotency. ADDITIVE ONLY: no column is
-- dropped or rewritten; money snapshots (subtotal/discount/shippingFee/priceAdjustment/total/priceSnapshot) untouched.

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE');

-- CreateEnum
CREATE TYPE "ShippingZoneMatchField" AS ENUM ('POSTCODE', 'DISTRICT', 'DIVISION');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "couponDiscount" DECIMAL(10,2),
ADD COLUMN     "couponReleasedAt" TIMESTAMP(3),
ADD COLUMN     "flashDiscount" DECIMAL(10,2),
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "pricingVersion" INTEGER,
ADD COLUMN     "shippingTaxAmount" DECIMAL(10,2),
ADD COLUMN     "shippingTaxRate" DECIMAL(5,2),
ADD COLUMN     "shippingWaived" BOOLEAN,
ADD COLUMN     "shippingZoneKey" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(10,2),
ADD COLUMN     "taxMode" "TaxMode",
ADD COLUMN     "taxRate" DECIMAL(5,2),
ADD COLUMN     "taxableAmount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "bundleDiscountAllocated" DECIMAL(10,2),
ADD COLUMN     "couponDiscountAllocated" DECIMAL(10,2),
ADD COLUMN     "flashSaleId" TEXT,
ADD COLUMN     "flashSaleItemId" TEXT,
ADD COLUMN     "listPriceSnapshot" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "PaymentSession" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateTable
CREATE TABLE "TaxSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" "TaxMode" NOT NULL DEFAULT 'INCLUSIVE',
    "defaultRate" DECIMAL(5,2),
    "shippingTaxable" BOOLEAN NOT NULL DEFAULT true,
    "shippingRate" DECIMAL(5,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingZoneMatch" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "field" "ShippingZoneMatchField" NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ShippingZoneMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingRate" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "fee" DECIMAL(10,2) NOT NULL,
    "freeOverAmount" DECIMAL(10,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingZone_key_key" ON "ShippingZone"("key");

-- CreateIndex
CREATE INDEX "ShippingZoneMatch_field_value_idx" ON "ShippingZoneMatch"("field", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingZoneMatch_zoneId_field_value_key" ON "ShippingZoneMatch"("zoneId", "field", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingRate_zoneId_key" ON "ShippingRate"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderItem_flashSaleItemId_idx" ON "OrderItem"("flashSaleItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSession_idempotencyKey_key" ON "PaymentSession"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "ShippingZoneMatch" ADD CONSTRAINT "ShippingZoneMatch_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ShippingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ShippingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Backfills ──────────────────────────────────────────────────────────────────────────────────────

-- 1. TaxSetting: the one tax authority, seeded from the legacy StoreSetting columns (defaults when no row yet).
INSERT INTO "TaxSetting" ("id", "enabled", "mode", "defaultRate", "shippingTaxable", "shippingRate", "updatedAt")
SELECT 'singleton', COALESCE(s."taxEnabled", false), 'INCLUSIVE', s."defaultTaxRate", true, NULL, CURRENT_TIMESTAMP
FROM (SELECT 1) AS one LEFT JOIN "StoreSetting" s ON s."id" = 'singleton'
ON CONFLICT ("id") DO NOTHING;

-- 2. Shipping zones reproducing today's rule exactly: Dhaka district at the "inside Dhaka" fee, everything else
--    (the default zone) at the "outside Dhaka" fee. Fees come from the legacy StoreSetting columns (defaults 60/120).
INSERT INTO "ShippingZone" ("id", "key", "name", "priority", "isDefault", "isActive", "createdAt", "updatedAt") VALUES
  ('zone_dhaka_district', 'dhaka-district', 'Inside Dhaka district', 10, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('zone_default', 'default', 'Rest of the country', 0, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "ShippingZoneMatch" ("id", "zoneId", "field", "value")
VALUES ('zmatch_dhaka_district', 'zone_dhaka_district', 'DISTRICT', 'Dhaka')
ON CONFLICT DO NOTHING;
INSERT INTO "ShippingRate" ("id", "zoneId", "fee", "freeOverAmount", "updatedAt")
SELECT 'zrate_dhaka_district', 'zone_dhaka_district', COALESCE(s."shippingFeeDhaka", 60), NULL, CURRENT_TIMESTAMP
FROM (SELECT 1) AS one LEFT JOIN "StoreSetting" s ON s."id" = 'singleton'
ON CONFLICT ("zoneId") DO NOTHING;
INSERT INTO "ShippingRate" ("id", "zoneId", "fee", "freeOverAmount", "updatedAt")
SELECT 'zrate_default', 'zone_default', COALESCE(s."shippingFeeOutsideDhaka", 120), NULL, CURRENT_TIMESTAMP
FROM (SELECT 1) AS one LEFT JOIN "StoreSetting" s ON s."id" = 'singleton'
ON CONFLICT ("zoneId") DO NOTHING;

-- 3. Order.shippingWaived — only where the order's OWN snapshot proves it (total = subtotal − discount + fee + adj
--    means charged; total = subtotal − discount + adj with a non-zero fee means waived). Anything else stays NULL.
UPDATE "Order" SET "shippingWaived" = false
WHERE "shippingWaived" IS NULL AND "shippingFee" = 0;
UPDATE "Order" SET "shippingWaived" = false
WHERE "shippingWaived" IS NULL AND "shippingFee" > 0
  AND "total" = "subtotal" - "discount" + "shippingFee" + "priceAdjustment";
UPDATE "Order" SET "shippingWaived" = true
WHERE "shippingWaived" IS NULL AND "shippingFee" > 0
  AND "total" = "subtotal" - "discount" + "priceAdjustment";

-- 4. Order.couponDiscount — the coupon's share of `discount`. No coupon ⇒ 0 (exchange orders' `discount` is the
--    customer's credit, not a coupon). With a coupon ⇒ discount − bundleDiscount (checkout's only two discounts).
UPDATE "Order" SET "couponDiscount" = 0 WHERE "couponDiscount" IS NULL AND "couponId" IS NULL;
UPDATE "Order" SET "couponDiscount" = "discount" - "bundleDiscount"
WHERE "couponDiscount" IS NULL AND "couponId" IS NOT NULL AND "discount" >= "bundleDiscount";

-- flashDiscount, tax fields, listPriceSnapshot, flash attribution and discount allocations are NOT backfilled: orders
-- placed before Phase 2 never recorded them and they can't be reconstructed from current data. They stay NULL
-- ("unknown"), never invented. couponReleasedAt stays NULL: historical cancellations never released usage.

-- Verification (run after deploy; see docs/PRICING_INVARIANTS.md §10):
--   SELECT count(*) FROM "TaxSetting";                                   -- 1
--   SELECT z.key, r.fee FROM "ShippingZone" z JOIN "ShippingRate" r ON r."zoneId" = z.id;  -- equals StoreSetting fees
--   SELECT count(*) FROM "Order" WHERE "shippingWaived" IS NULL;         -- orders whose snapshot doesn't add up (review)
--   SELECT count(*) FROM "Order" WHERE "couponId" IS NOT NULL AND "couponDiscount" IS NULL;  -- expected 0
