-- Manufacturing M4 — deliveries, inspection and finished goods (docs/MANUFACTURING.md §8). Accepted units enter stock
-- (PRODUCTION_RECEIPT) at the order's provisional unit cost; their value leaves work in progress (Dr 1610 / Cr 1630).
--   R-1 delivered = accepted + rejected + rework;  R-2 receipt lifecycle, immutability;  R-3 order-line received
--   quantities derived from posted receipts;  R-4 audit at commit, no TRUNCATE.

-- CreateEnum
CREATE TYPE "ProductionReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- AlterEnum
ALTER TYPE "StockMovementReason" ADD VALUE 'PRODUCTION_RECEIPT';

-- AlterTable
ALTER TABLE "ProductionOrderLine" ADD COLUMN     "acceptedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveredQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rejectedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reworkQty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProductionReceipt" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "ProductionReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "receiptDate" DATE NOT NULL,
    "deliveryRef" TEXT,
    "inspectionNotes" TEXT,
    "evidence" TEXT,
    "overReceiptReason" TEXT,
    "provisionalUnitCost" DECIMAL(18,6),
    "createdByAdminId" TEXT,
    "postedByAdminId" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversedByAdminId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "delivered" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "rework" INTEGER NOT NULL DEFAULT 0,
    "rejectReason" TEXT,
    "unitCost" DECIMAL(18,2),
    "value" DECIMAL(18,2),
    "stockMovementId" TEXT,
    "reversalMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionReceipt_productionOrderId_status_idx" ON "ProductionReceipt"("productionOrderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionReceiptLine_stockMovementId_key" ON "ProductionReceiptLine"("stockMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionReceiptLine_reversalMovementId_key" ON "ProductionReceiptLine"("reversalMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionReceiptLine_receiptId_orderLineId_key" ON "ProductionReceiptLine"("receiptId", "orderLineId");

-- AddForeignKey
ALTER TABLE "ProductionReceipt" ADD CONSTRAINT "ProductionReceipt_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReceiptLine" ADD CONSTRAINT "ProductionReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ProductionReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReceiptLine" ADD CONSTRAINT "ProductionReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "ProductionOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReceiptLine" ADD CONSTRAINT "ProductionReceiptLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- R-1 quantities reconcile: delivered = accepted + rejected + rework; value = accepted × unit cost once posted
ALTER TABLE "ProductionReceiptLine" ADD CONSTRAINT "ProductionReceiptLine_values" CHECK (
  "delivered" > 0 AND "accepted" >= 0 AND "rejected" >= 0 AND "rework" >= 0 AND "delivered" = "accepted" + "rejected" + "rework"
  AND (("unitCost" IS NULL) = ("value" IS NULL)) AND ("value" IS NULL OR ("unitCost" >= 0 AND "value" = "accepted" * "unitCost")));
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_received" CHECK (
  "deliveredQty" >= 0 AND "acceptedQty" >= 0 AND "rejectedQty" >= 0 AND "reworkQty" >= 0 AND "deliveredQty" = "acceptedQty" + "rejectedQty" + "reworkQty");
ALTER TABLE "ProductionReceipt" ADD CONSTRAINT "ProductionReceipt_status_fields" CHECK (
  ("status" = 'DRAFT') = ("postedAt" IS NULL) AND ("status" = 'REVERSED') = ("reversedAt" IS NOT NULL) AND ("status" = 'DRAFT' OR "provisionalUnitCost" IS NOT NULL));

-- R-2 lifecycle: DRAFT → POSTED → REVERSED; posted / reversed immutable (a reversal records only its own fields); drafts deleted
CREATE OR REPLACE FUNCTION mfg_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a posted production receipt is never deleted (reverse it)' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'REVERSED' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a reversed production receipt is final' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (('DRAFT', 'POSTED'), ('POSTED', 'REVERSED'))) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a production receipt can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'POSTED' AND (NEW."productionOrderId", NEW.number, NEW."receiptDate", NEW."deliveryRef", NEW."overReceiptReason", NEW."provisionalUnitCost", NEW."postedAt")
     IS DISTINCT FROM (OLD."productionOrderId", OLD.number, OLD."receiptDate", OLD."deliveryRef", OLD."overReceiptReason", OLD."provisionalUnitCost", OLD."postedAt") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a posted production receipt is immutable (reverse it)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionReceipt_guard" BEFORE UPDATE OR DELETE ON "ProductionReceipt" FOR EACH ROW EXECUTE FUNCTION mfg_receipt_guard();

CREATE OR REPLACE FUNCTION mfg_receipt_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO s FROM "ProductionReceipt" WHERE id = COALESCE(NEW."receiptId", OLD."receiptId");
  IF s = 'DRAFT' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF s = 'POSTED' AND TG_OP = 'UPDATE' AND OLD."reversalMovementId" IS NULL
     AND (NEW."receiptId", NEW."orderLineId", NEW."variantId", NEW.delivered, NEW.accepted, NEW.rejected, NEW.rework, NEW."unitCost", NEW.value, NEW."stockMovementId")
         IS NOT DISTINCT FROM (OLD."receiptId", OLD."orderLineId", OLD."variantId", OLD.delivered, OLD.accepted, OLD.rejected, OLD.rework, OLD."unitCost", OLD.value, OLD."stockMovementId") THEN
    RETURN NEW; -- the reversal records its stock movement
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: a posted production receipt''s lines are immutable' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "ProductionReceiptLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProductionReceiptLine" FOR EACH ROW EXECUTE FUNCTION mfg_receipt_line_guard();

-- R-3 an order line's delivered / accepted / rejected / rework quantities are DERIVED from posted receipts
CREATE OR REPLACE FUNCTION mfg_receipt_derive() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sign int;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NULL; END IF;
  sign := CASE WHEN (OLD.status, NEW.status) = ('DRAFT', 'POSTED') THEN 1 WHEN (OLD.status, NEW.status) = ('POSTED', 'REVERSED') THEN -1 ELSE 0 END;
  IF sign = 0 THEN RETURN NULL; END IF;
  PERFORM set_config('manufacturing.derive_receipts', 'on', true);
  UPDATE "ProductionOrderLine" ol
     SET "deliveredQty" = ol."deliveredQty" + sign * r.delivered, "acceptedQty" = ol."acceptedQty" + sign * r.accepted,
         "rejectedQty" = ol."rejectedQty" + sign * r.rejected, "reworkQty" = ol."reworkQty" + sign * r.rework, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    FROM "ProductionReceiptLine" r
   WHERE r."receiptId" = NEW.id AND ol.id = r."orderLineId";
  PERFORM set_config('manufacturing.derive_receipts', '', true);
  RETURN NULL;
END $$;
CREATE TRIGGER "ProductionReceipt_derive" AFTER UPDATE OF status ON "ProductionReceipt" FOR EACH ROW EXECUTE FUNCTION mfg_receipt_derive();

-- the plan guard, extended: order-line received quantities change only through R-3
CREATE OR REPLACE FUNCTION mfg_production_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO s FROM "ProductionOrder" WHERE id = COALESCE(NEW."productionOrderId", OLD."productionOrderId");
  -- (each NEW field reference is nested under its table: PL/pgSQL plans it even when an AND before it is false)
  IF TG_TABLE_NAME = 'ProductionMaterialLine' AND TG_OP = 'UPDATE' THEN
    IF (NEW."issuedQty", NEW."returnedQty") IS DISTINCT FROM (OLD."issuedQty", OLD."returnedQty")
       AND coalesce(current_setting('manufacturing.derive_custody', true), '') <> 'on' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: issued / returned quantities are derived from material moves' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'ProductionOrderLine' AND TG_OP = 'UPDATE' THEN
    IF (NEW."deliveredQty", NEW."acceptedQty", NEW."rejectedQty", NEW."reworkQty") IS DISTINCT FROM (OLD."deliveredQty", OLD."acceptedQty", OLD."rejectedQty", OLD."reworkQty") THEN
      IF coalesce(current_setting('manufacturing.derive_receipts', true), '') <> 'on' THEN
        RAISE EXCEPTION 'FINANCE_INVARIANT: delivered / accepted / rejected quantities are derived from production receipts' USING ERRCODE = 'check_violation';
      END IF;
      IF (NEW."productionOrderId", NEW."lineNo", NEW."variantId", NEW."plannedQty") IS NOT DISTINCT FROM (OLD."productionOrderId", OLD."lineNo", OLD."variantId", OLD."plannedQty") THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  IF s = 'DRAFT' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'ProductionMaterialLine' AND TG_OP = 'UPDATE' THEN
    IF s IN ('APPROVED', 'IN_PRODUCTION', 'PARTIALLY_RECEIVED', 'RECEIVED')
       AND (NEW."productionOrderId", NEW."lineNo", NEW."materialVariantId", NEW."suppliedBy", NEW."fromBom", NEW."bomLineId", NEW."qtyPerUnit", NEW."wastagePct", NEW."plannedQty", NEW."plannedUnitCost")
           IS NOT DISTINCT FROM (OLD."productionOrderId", OLD."lineNo", OLD."materialVariantId", OLD."suppliedBy", OLD."fromBom", OLD."bomLineId", OLD."qtyPerUnit", OLD."wastagePct", OLD."plannedQty", OLD."plannedUnitCost") THEN
      RETURN NEW;
    END IF;
    IF s = 'APPROVED' AND OLD."issuedQty" = 0 AND NEW."issuedQty" = 0
       AND (NEW."productionOrderId", NEW."lineNo", NEW."materialVariantId", NEW."suppliedBy", NEW."fromBom", NEW."bomLineId", NEW."qtyPerUnit", NEW."wastagePct", NEW."plannedQty")
           IS NOT DISTINCT FROM (OLD."productionOrderId", OLD."lineNo", OLD."materialVariantId", OLD."suppliedBy", OLD."fromBom", OLD."bomLineId", OLD."qtyPerUnit", OLD."wastagePct", OLD."plannedQty") THEN
      RETURN NEW; -- approval snapshots the planned unit cost
    END IF;
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: an approved production order''s plan is frozen (send it back to draft while nothing is issued)' USING ERRCODE = 'check_violation';
END $$;

-- R-4 audit at commit, no TRUNCATE
CREATE CONSTRAINT TRIGGER "ProductionReceipt_audit" AFTER INSERT OR UPDATE OR DELETE ON "ProductionReceipt"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('ProductionReceipt');
CREATE TRIGGER "ProductionReceipt_no_truncate" BEFORE TRUNCATE ON "ProductionReceipt" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "ProductionReceiptLine_no_truncate" BEFORE TRUNCATE ON "ProductionReceiptLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
