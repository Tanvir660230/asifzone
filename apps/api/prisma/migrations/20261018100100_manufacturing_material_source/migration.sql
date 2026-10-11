-- Manufacturing M1: a material requirement records whether it came from the BOM (several BOM lines of one material combine
-- into one requirement, so the single-line snapshot alone cannot tell) — re-planning a draft replaces only those.
ALTER TABLE "ProductionMaterialLine" ADD COLUMN "fromBom" BOOLEAN NOT NULL DEFAULT false;

-- the plan guard: fromBom is part of the frozen plan
CREATE OR REPLACE FUNCTION mfg_production_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO s FROM "ProductionOrder" WHERE id = COALESCE(NEW."productionOrderId", OLD."productionOrderId");
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
