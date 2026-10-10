-- Manufacturing M2 — materials custody and work in progress (docs/MANUFACTURING.md §6). Material leaves stock for a
-- production order (PRODUCTION_ISSUE) and unused material comes back (PRODUCTION_RETURN) as append-only moves; the
-- books move the value between inventory (1610) and work in progress (1630) per order.
--   W-1 values;  W-2 moves append-only, own order, business-supplied, open order;  W-3 issued / returned derived from
--   moves (custody CHECK I-6 then holds);  W-4 audit at commit, no TRUNCATE.

-- CreateEnum
CREATE TYPE "ProductionMoveKind" AS ENUM ('ISSUE', 'RETURN');

-- AlterEnum


ALTER TYPE "StockMovementReason" ADD VALUE 'PRODUCTION_ISSUE';
ALTER TYPE "StockMovementReason" ADD VALUE 'PRODUCTION_RETURN';

-- CreateTable
CREATE TABLE "ProductionMaterialMove" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "materialLineId" TEXT NOT NULL,
    "kind" "ProductionMoveKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "valuationStatus" "FinanceValuationStatus" NOT NULL,
    "stockMovementId" TEXT NOT NULL,
    "requestKey" TEXT,
    "overIssueReason" TEXT,
    "note" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionMaterialMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionMaterialMove_stockMovementId_key" ON "ProductionMaterialMove"("stockMovementId");

-- CreateIndex
CREATE INDEX "ProductionMaterialMove_productionOrderId_createdAt_idx" ON "ProductionMaterialMove"("productionOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionMaterialMove_materialLineId_idx" ON "ProductionMaterialMove"("materialLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionMaterialMove_productionOrderId_requestKey_materia_key" ON "ProductionMaterialMove"("productionOrderId", "requestKey", "materialLineId", "kind");

-- AddForeignKey
ALTER TABLE "ProductionMaterialMove" ADD CONSTRAINT "ProductionMaterialMove_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionMaterialMove" ADD CONSTRAINT "ProductionMaterialMove_materialLineId_fkey" FOREIGN KEY ("materialLineId") REFERENCES "ProductionMaterialLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- W-1 values
ALTER TABLE "ProductionMaterialMove" ADD CONSTRAINT "ProductionMaterialMove_values" CHECK (
  "quantity" > 0 AND "value" >= 0 AND "valuationStatus" IN ('KNOWN', 'ESTIMATED', 'MISSING')
  AND ("kind" = 'ISSUE' OR "overIssueReason" IS NULL));

-- W-2 moves are append-only, belong to their order, and only business-supplied material moves
CREATE OR REPLACE FUNCTION mfg_material_move_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l "ProductionMaterialLine"%ROWTYPE; st text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: material moves are append-only (return or issue again)' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO l FROM "ProductionMaterialLine" WHERE id = NEW."materialLineId";
  IF l."productionOrderId" <> NEW."productionOrderId" THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a material move names a line of its own order' USING ERRCODE = 'check_violation'; END IF;
  IF l."suppliedBy" <> 'BUSINESS' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: producer-supplied material is never issued' USING ERRCODE = 'check_violation'; END IF;
  SELECT status INTO st FROM "ProductionOrder" WHERE id = NEW."productionOrderId";
  IF st NOT IN ('APPROVED', 'IN_PRODUCTION', 'PARTIALLY_RECEIVED', 'RECEIVED') THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: material moves only on an approved, open production order (it is %)', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionMaterialMove_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProductionMaterialMove" FOR EACH ROW EXECUTE FUNCTION mfg_material_move_guard();

-- W-3 issued / returned quantities are DERIVED from the moves (the CHECK on the line then enforces custody I-6)
CREATE OR REPLACE FUNCTION mfg_material_move_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('manufacturing.derive_custody', 'on', true);
  UPDATE "ProductionMaterialLine"
     SET "issuedQty" = "issuedQty" + CASE WHEN NEW.kind = 'ISSUE' THEN NEW.quantity ELSE 0 END,
         "returnedQty" = "returnedQty" + CASE WHEN NEW.kind = 'RETURN' THEN NEW.quantity ELSE 0 END,
         "updatedAt" = (NOW() AT TIME ZONE 'UTC')
   WHERE id = NEW."materialLineId";
  PERFORM set_config('manufacturing.derive_custody', '', true);
  RETURN NULL;
END $$;
CREATE TRIGGER "ProductionMaterialMove_derive" AFTER INSERT ON "ProductionMaterialMove" FOR EACH ROW EXECUTE FUNCTION mfg_material_move_derive();

-- the plan guard, extended: issued / returned change only through W-3; consumed / scrapped are declared while in production
CREATE OR REPLACE FUNCTION mfg_production_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO s FROM "ProductionOrder" WHERE id = COALESCE(NEW."productionOrderId", OLD."productionOrderId");
  -- (nested: PL/pgSQL plans a NEW field reference even when an AND before it is false, and the other tables lack the field)
  IF TG_TABLE_NAME = 'ProductionMaterialLine' AND TG_OP = 'UPDATE' THEN
    IF (NEW."issuedQty", NEW."returnedQty") IS DISTINCT FROM (OLD."issuedQty", OLD."returnedQty")
       AND coalesce(current_setting('manufacturing.derive_custody', true), '') <> 'on' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: issued / returned quantities are derived from material moves' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF s = 'DRAFT' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'ProductionMaterialLine' AND TG_OP = 'UPDATE' AND s IN ('APPROVED', 'IN_PRODUCTION', 'PARTIALLY_RECEIVED', 'RECEIVED')
     AND (NEW."productionOrderId", NEW."lineNo", NEW."materialVariantId", NEW."suppliedBy", NEW."fromBom", NEW."bomLineId", NEW."qtyPerUnit", NEW."wastagePct", NEW."plannedQty", NEW."plannedUnitCost")
         IS NOT DISTINCT FROM (OLD."productionOrderId", OLD."lineNo", OLD."materialVariantId", OLD."suppliedBy", OLD."fromBom", OLD."bomLineId", OLD."qtyPerUnit", OLD."wastagePct", OLD."plannedQty", OLD."plannedUnitCost") THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'ProductionMaterialLine' AND TG_OP = 'UPDATE' AND s = 'APPROVED' AND OLD."issuedQty" = 0 AND NEW."issuedQty" = 0
     AND (NEW."productionOrderId", NEW."lineNo", NEW."materialVariantId", NEW."suppliedBy", NEW."fromBom", NEW."bomLineId", NEW."qtyPerUnit", NEW."wastagePct", NEW."plannedQty")
         IS NOT DISTINCT FROM (OLD."productionOrderId", OLD."lineNo", OLD."materialVariantId", OLD."suppliedBy", OLD."fromBom", OLD."bomLineId", OLD."qtyPerUnit", OLD."wastagePct", OLD."plannedQty") THEN
    RETURN NEW; -- approval snapshots the planned unit cost
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: an approved production order''s plan is frozen (send it back to draft while nothing is issued)' USING ERRCODE = 'check_violation';
END $$;

-- W-4 audit at commit, no TRUNCATE
CREATE CONSTRAINT TRIGGER "ProductionMaterialMove_audit" AFTER INSERT OR UPDATE OR DELETE ON "ProductionMaterialMove"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('ProductionMaterialMove');
CREATE TRIGGER "ProductionMaterialMove_no_truncate" BEFORE TRUNCATE ON "ProductionMaterialMove" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
