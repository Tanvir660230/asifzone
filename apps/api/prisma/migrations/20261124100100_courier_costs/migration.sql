-- CreateEnum
CREATE TYPE "ShipmentType" AS ENUM ('OUTBOUND', 'RETURN', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "ShipmentOperationalStatus" AS ENUM ('BOOKED', 'IN_TRANSIT', 'DELIVERED', 'PARTIALLY_DELIVERED', 'RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentChargeStatus" AS ENUM ('MISSING', 'ENTERED', 'VERIFIED', 'COURIER_CONFIRMED');

-- CreateEnum
CREATE TYPE "ShipmentContributionStatus" AS ENUM ('NOT_RECORDED', 'REPORTED', 'VERIFIED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "ShipmentUncoveredTreatment" AS ENUM ('UNDECIDED', 'ABSORBED', 'RECEIVABLE', 'RECOVERED');

-- CreateEnum
CREATE TYPE "ShipmentExcessTreatment" AS ENUM ('UNDECIDED', 'REFUND_DUE', 'REFUNDED', 'KEPT_BY_COURIER', 'OTHER_INCOME', 'ALLOCATED_WITHIN_EXCHANGE');

-- CreateEnum
CREATE TYPE "ShipmentFinancialStatus" AS ENUM ('NOT_DUE', 'AWAITING_ACTUAL_CHARGE', 'AWAITING_CONTRIBUTION', 'EXCESS_REVIEW', 'NOT_COVERED', 'PARTIALLY_COVERED', 'FULLY_COVERED', 'RECONCILED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "parcelOrderId" TEXT,
    "returnRequestId" TEXT,
    "type" "ShipmentType" NOT NULL,
    "courier" TEXT NOT NULL,
    "consignmentId" TEXT,
    "trackingCode" TEXT,
    "courierStatus" TEXT,
    "courierSyncedAt" TIMESTAMP(3),
    "operationalStatus" "ShipmentOperationalStatus" NOT NULL,
    "trackedByCourier" BOOLEAN NOT NULL DEFAULT false,
    "deliveryZone" TEXT,
    "weightKg" DECIMAL(8,3),
    "bookedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "bookedCodAmount" DECIMAL(10,2),
    "courierPayoutRef" TEXT,
    "courierCollected" DECIMAL(10,2),
    "standardCharge" DECIMAL(10,2),
    "standardChargeSource" TEXT,
    "estimatedCharge" DECIMAL(10,2),
    "quotedCharge" DECIMAL(10,2),
    "actualCharge" DECIMAL(10,2),
    "chargeStatus" "ShipmentChargeStatus" NOT NULL DEFAULT 'MISSING',
    "chargeSource" TEXT,
    "chargeReference" TEXT,
    "chargeVerifiedByAdminId" TEXT,
    "chargeVerifiedAt" TIMESTAMP(3),
    "contributionReported" DECIMAL(10,2),
    "contributionVerified" DECIMAL(10,2),
    "contributionStatus" "ShipmentContributionStatus" NOT NULL DEFAULT 'NOT_RECORDED',
    "contributionSource" TEXT,
    "contributionReference" TEXT,
    "contributionVerifiedByAdminId" TEXT,
    "contributionVerifiedAt" TIMESTAMP(3),
    "uncoveredTreatment" "ShipmentUncoveredTreatment" NOT NULL DEFAULT 'UNDECIDED',
    "excessTreatment" "ShipmentExcessTreatment" NOT NULL DEFAULT 'UNDECIDED',
    "financialStatus" "ShipmentFinancialStatus" NOT NULL DEFAULT 'NOT_DUE',
    "uncoveredAmount" DECIMAL(10,2),
    "excessAmount" DECIMAL(10,2),
    "reviewReason" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "reconciledByAdminId" TEXT,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentCostEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "note" TEXT,
    "source" TEXT,
    "reference" TEXT,
    "adminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentCostEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_idempotencyKey_key" ON "Shipment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_parcelOrderId_idx" ON "Shipment"("parcelOrderId");

-- CreateIndex
CREATE INDEX "Shipment_returnRequestId_idx" ON "Shipment"("returnRequestId");

-- CreateIndex
CREATE INDEX "Shipment_financialStatus_idx" ON "Shipment"("financialStatus");

-- CreateIndex
CREATE INDEX "Shipment_completedAt_idx" ON "Shipment"("completedAt");

-- CreateIndex
CREATE INDEX "Shipment_consignmentId_idx" ON "Shipment"("consignmentId");

-- CreateIndex
CREATE INDEX "ShipmentCostEvent_shipmentId_createdAt_idx" ON "ShipmentCostEvent"("shipmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_parcelOrderId_fkey" FOREIGN KEY ("parcelOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentCostEvent" ADD CONSTRAINT "ShipmentCostEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Duplicate guards (Prisma's schema DSL can't express partial unique indexes) ────────────────────────────────────────
-- One leg per consignment and leg type (a RETURN collected under the original consignment is a different leg).
CREATE UNIQUE INDEX "Shipment_courier_consignment_type_key" ON "Shipment"("courier", "consignmentId", "type") WHERE "consignmentId" IS NOT NULL;
-- One untracked delivery / replacement leg per parcel order (a manual carrier).
CREATE UNIQUE INDEX "Shipment_parcel_untracked_key" ON "Shipment"("parcelOrderId", "type") WHERE "consignmentId" IS NULL AND "type" <> 'RETURN';
-- One return leg per return / exchange request.
CREATE UNIQUE INDEX "Shipment_return_request_return_key" ON "Shipment"("returnRequestId") WHERE "returnRequestId" IS NOT NULL AND "type" = 'RETURN';

-- Money is never negative.
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_money_non_negative" CHECK (
  COALESCE("actualCharge", 0) >= 0 AND COALESCE("quotedCharge", 0) >= 0 AND COALESCE("standardCharge", 0) >= 0 AND COALESCE("estimatedCharge", 0) >= 0
  AND COALESCE("contributionReported", 0) >= 0 AND COALESCE("contributionVerified", 0) >= 0 AND COALESCE("weightKg", 0) >= 0
  AND COALESCE("courierCollected", 0) >= 0 AND COALESCE("bookedCodAmount", 0) >= 0
);
-- A confirmed charge has an amount.
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_charge_status_amount" CHECK ("chargeStatus" = 'MISSING' OR "actualCharge" IS NOT NULL);

-- The history is append-only: rows are never edited (they go only with their shipment).
CREATE OR REPLACE FUNCTION shipment_cost_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ShipmentCostEvent rows are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ShipmentCostEvent_no_update" BEFORE UPDATE ON "ShipmentCostEvent" FOR EACH ROW EXECUTE FUNCTION shipment_cost_event_immutable();

-- ── Backfill: one leg for every consignment already booked (historical orders keep working) ─────────────────────────
-- Charges stay unknown (MISSING) — nothing is assumed; the courier payout check and admins fill them in.
WITH booked AS (
  SELECT o.id, o.status, o."courierStatus", o."courierConsignmentId", o."trackingNumber", o."courierBookedAt", o."courierStatusSyncedAt", o."updatedAt", o."createdAt",
         rr.id AS "exchangeRequestId", rr."orderId" AS "originalOrderId",
         EXISTS (SELECT 1 FROM "OrderStatusHistory" h WHERE h."orderId" = o.id AND h.status = 'SHIPPED') AS shipped
  FROM "Order" o
  LEFT JOIN "ReturnRequest" rr ON rr."exchangeOrderId" = o.id
  WHERE o."courierConsignmentId" IS NOT NULL
), legs AS (
  SELECT b.*,
    CASE
      WHEN lower(coalesce(b."courierStatus", '')) LIKE 'partial_delivered%' THEN 'PARTIALLY_DELIVERED'
      WHEN lower(coalesce(b."courierStatus", '')) LIKE 'delivered%' THEN 'DELIVERED'
      WHEN lower(coalesce(b."courierStatus", '')) LIKE 'cancelled%' THEN
        CASE WHEN b.status IN ('RETURNED', 'REFUNDED') OR b.shipped THEN 'RETURNED' ELSE 'CANCELLED' END
      WHEN b.status = 'DELIVERED' THEN 'DELIVERED'
      WHEN b.status = 'PARTIALLY_DELIVERED' THEN 'PARTIALLY_DELIVERED'
      WHEN b.status IN ('RETURNED', 'REFUNDED') THEN 'RETURNED'
      WHEN b.status = 'CANCELLED' THEN CASE WHEN b.shipped THEN 'RETURNED' ELSE 'CANCELLED' END
      WHEN b.status = 'SHIPPED' THEN 'IN_TRANSIT'
      ELSE 'BOOKED'
    END AS op
  FROM booked b
)
INSERT INTO "Shipment" ("id", "orderId", "parcelOrderId", "returnRequestId", "type", "courier", "consignmentId", "trackingCode", "courierStatus",
  "courierSyncedAt", "operationalStatus", "trackedByCourier", "bookedAt", "completedAt", "financialStatus", "createdAt", "updatedAt")
SELECT
  'shp' || substr(md5(l.id || ':' || l."courierConsignmentId"), 1, 22),
  coalesce(l."originalOrderId", l.id), l.id, l."exchangeRequestId",
  (CASE WHEN l."exchangeRequestId" IS NOT NULL THEN 'REPLACEMENT' ELSE 'OUTBOUND' END)::"ShipmentType",
  'Steadfast', l."courierConsignmentId", l."trackingNumber", l."courierStatus", l."courierStatusSyncedAt",
  l.op::"ShipmentOperationalStatus", true, l."courierBookedAt",
  CASE WHEN l.op IN ('DELIVERED', 'PARTIALLY_DELIVERED', 'RETURNED', 'CANCELLED') THEN coalesce(l."courierStatusSyncedAt", l."updatedAt") END,
  (CASE WHEN l.op IN ('DELIVERED', 'PARTIALLY_DELIVERED', 'RETURNED') THEN 'AWAITING_ACTUAL_CHARGE' ELSE 'NOT_DUE' END)::"ShipmentFinancialStatus",
  coalesce(l."courierBookedAt", l."createdAt"), now()
FROM legs l
ON CONFLICT DO NOTHING;

INSERT INTO "ShipmentCostEvent" ("id", "shipmentId", "action", "changes", "note", "source")
SELECT 'sce' || substr(md5(s.id), 1, 22), s.id, 'CREATED', '{}'::jsonb, 'Recorded from the existing courier booking when shipment tracking was introduced', 'BACKFILL'
FROM "Shipment" s;
