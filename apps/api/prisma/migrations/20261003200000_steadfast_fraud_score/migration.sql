-- Steadfast stopped returning parcel counts from GET /fraud_check/{phone} on 2026-09-27 (every count is
-- now 0); its replacement GET /fraud_check/score/{phone} returns ratios and a volume range instead of
-- exact counts. ADDITIVE: three nullable columns for what the new endpoint actually provides.
ALTER TABLE "Customer" ADD COLUMN "deliveryCancellationRate" DOUBLE PRECISION;
ALTER TABLE "Customer" ADD COLUMN "deliveryVolumeRange" TEXT;
ALTER TABLE "Customer" ADD COLUMN "deliveryFraudReports" INTEGER;

-- Every check since the cut-over cached the dead endpoint's all-zero answer, which the admin order list
-- shows as "No history". Forget those so the row falls back to the "Check score" button and gets a
-- real score on the next check instead of a misleading cached one.
UPDATE "Customer"
SET "deliveryScoreCheckedAt" = NULL,
    "deliveryTotalParcels" = NULL,
    "deliverySuccessParcels" = NULL,
    "deliveryCancelledParcels" = NULL,
    "deliverySuccessRate" = NULL
WHERE "deliveryScoreCheckedAt" >= '2026-09-27' AND COALESCE("deliveryTotalParcels", 0) = 0;
