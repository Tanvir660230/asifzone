-- Financial Core Phase 4B (docs/FINANCE_PHASE_4.md §9): order-line cost source and the stock exit it was costed at, the exact
-- integer cost of snapshot valuations, and the costing activation switch. Additive only: no existing row is changed.

-- CreateEnum
CREATE TYPE "OrderLineCostSource" AS ENUM ('INVENTORY', 'INVENTORY_PROVISIONAL', 'CATALOG', 'NONE');

-- AlterTable
ALTER TABLE "FinanceBusiness" ADD COLUMN     "inventoryCostingActivatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InventoryValuationEntry" ADD COLUMN     "unitCostMinor" INTEGER;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "costMovementId" TEXT,
ADD COLUMN     "unitCostSource" "OrderLineCostSource";

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_costMovementId_fkey" FOREIGN KEY ("costMovementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE INDEX "OrderItem_costMovementId_idx" ON "OrderItem"("costMovementId");

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Phase 4B invariants (docs/FINANCE_PHASE_4.md §9): for every costed stock exit, the order line's recorded unit cost and
-- the valuation entry of that exit are the same integer — proven by the database, not just by the code.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_catalog_cost_unlinked" CHECK ("unitCostSource" IS DISTINCT FROM 'CATALOG' OR "costMovementId" IS NULL);
ALTER TABLE "InventoryValuationEntry" ADD CONSTRAINT "InventoryValuationEntry_minor_only_snapshot" CHECK ("costBasis" = 'SNAPSHOT' OR "unitCostMinor" IS NULL);

CREATE OR REPLACE FUNCTION finance_order_line_cost_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "InventoryValuationEntry"%ROWTYPE; mv "StockMovement"%ROWTYPE;
BEGIN
  IF finance_purge_allowed() THEN RETURN NEW; END IF;
  -- A line costed at a stock exit keeps its cost and its source for good.
  IF TG_OP = 'UPDATE' AND OLD."costMovementId" IS NOT NULL
     AND (NEW."unitCostSnapshot", NEW."unitCostSource") IS DISTINCT FROM (OLD."unitCostSnapshot", OLD."unitCostSource") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: order line % cost is recorded at its stock exit and never changes', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."costMovementId" IS NOT NULL AND NEW."costMovementId" IS DISTINCT FROM OLD."costMovementId" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: order line % stays linked to the stock exit it was costed at', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."costMovementId" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."costMovementId" IS NULL) THEN
    SELECT * INTO mv FROM "StockMovement" WHERE id = NEW."costMovementId";
    SELECT * INTO e FROM "InventoryValuationEntry" WHERE "stockMovementId" = NEW."costMovementId";
    IF NOT FOUND OR mv.reason <> 'ORDER' OR mv."orderId" IS DISTINCT FROM NEW."orderId" OR mv."variantId" <> NEW."variantId"
       OR e.kind <> 'OUTFLOW' OR e."costBasis" <> 'SNAPSHOT'
       OR e."unitCostMinor" IS DISTINCT FROM NEW."unitCostSnapshot"
       OR NEW."unitCostSource" IS NULL OR NEW."unitCostSource" = 'CATALOG' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: order line % cost (%) differs from the valuation of its stock exit (%)', NEW.id, NEW."unitCostSnapshot", e."unitCostMinor" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OrderItem_cost_guard" BEFORE INSERT OR UPDATE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION finance_order_line_cost_guard();

-- Activation is a one-way switch (4C sets it with the cutover); never moved or cleared.
CREATE OR REPLACE FUNCTION finance_costing_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN NEW; END IF;
  IF OLD."inventoryCostingActivatedAt" IS NOT NULL AND NEW."inventoryCostingActivatedAt" IS DISTINCT FROM OLD."inventoryCostingActivatedAt" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: inventory costing, once active, stays active from the same moment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FinanceBusiness_costing_activation_guard" BEFORE UPDATE ON "FinanceBusiness" FOR EACH ROW EXECUTE FUNCTION finance_costing_activation_guard();

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Phase 4B persistence path (docs/FINANCE_PHASE_4.md §9.4). Writes valuations the costing engine (costing.service.ts,
-- applyCostOperation — the only place the costing rules live) has already computed: for each item, the entry, the variant's
-- running position (= that entry's after-values) and, for an order's stock exit, the exit's cost on its order lines. One
-- call, statements in order, so the stock row lock is held for one round trip instead of several. No arithmetic here:
-- every figure arrives computed; the guard triggers (continuity, position = latest entry, line cost = exit valuation) run
-- exactly as for any other write and refuse anything inconsistent. Called only by costing.service.ts (architecture guard).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION finance_persist_valuations(items jsonb) RETURNS TABLE (entry_id text, entry_sequence bigint) LANGUAGE plpgsql AS $$
DECLARE it jsonb; e jsonb; l jsonb; seq bigint; n int; wanted int;
BEGIN
  FOR it IN SELECT value FROM jsonb_array_elements(items) LOOP
    e := it->'entry';
    INSERT INTO "InventoryValuationEntry" (
      id, "businessId", "brandId", "variantId", "stockMovementId", kind, "qtyChange", "valueChange", "bookValue", "costAdjustment",
      "unitCost", "unitCostMinor", "costBasis", "valuationStatus", "deficitQtyChange", "coveredQty", "unvaluedQtyChange",
      "qtyAfter", "valueAfter", "avgAfter", "unvaluedAfter", "deficitAfter", "sourceType", "sourceId", "financialDate", note, "createdAt")
    VALUES (
      e->>'id', e->>'businessId', e->>'brandId', e->>'variantId', e->>'stockMovementId', (e->>'kind')::"InventoryValuationKind",
      (e->>'qtyChange')::int, (e->>'valueChange')::numeric, (e->>'bookValue')::numeric, (e->>'costAdjustment')::numeric,
      (e->>'unitCost')::numeric, (e->>'unitCostMinor')::int, e->>'costBasis', (e->>'valuationStatus')::"FinanceValuationStatus",
      (e->>'deficitQtyChange')::int, (e->>'coveredQty')::int, (e->>'unvaluedQtyChange')::int,
      (e->>'qtyAfter')::int, (e->>'valueAfter')::numeric, (e->>'avgAfter')::numeric, (e->>'unvaluedAfter')::int, (e->>'deficitAfter')::int,
      e->>'sourceType', e->>'sourceId', (e->>'financialDate')::date, e->>'note', (e->>'createdAt')::timestamp)
    RETURNING sequence INTO seq;

    UPDATE "InventoryCostState" SET
      "valuedQty" = (e->>'qtyAfter')::int, value = (e->>'valueAfter')::numeric, "avgUnitCost" = (e->>'avgAfter')::numeric,
      "unvaluedQty" = (e->>'unvaluedAfter')::int, "deficitQty" = (e->>'deficitAfter')::int, "deficitLayers" = it->'deficitLayers',
      "lastEntryId" = e->>'id', "updatedAt" = (e->>'createdAt')::timestamp
    WHERE "variantId" = e->>'variantId';
    IF NOT FOUND THEN
      INSERT INTO "InventoryCostState" ("variantId", "businessId", "valuedQty", value, "avgUnitCost", "unvaluedQty", "deficitQty", "deficitLayers", "lastEntryId", "updatedAt")
      VALUES (e->>'variantId', e->>'businessId', (e->>'qtyAfter')::int, (e->>'valueAfter')::numeric, (e->>'avgAfter')::numeric,
              (e->>'unvaluedAfter')::int, (e->>'deficitAfter')::int, it->'deficitLayers', e->>'id', (e->>'createdAt')::timestamp);
    END IF;

    l := it->'lines';
    IF l IS NOT NULL AND jsonb_typeof(l) = 'object' THEN
      wanted := jsonb_array_length(l->'ids');
      UPDATE "OrderItem" SET "unitCostSnapshot" = (l->>'unitCostSnapshot')::int, "unitCostSource" = (l->>'unitCostSource')::"OrderLineCostSource",
             "costMovementId" = e->>'stockMovementId'
      WHERE id IN (SELECT jsonb_array_elements_text(l->'ids')) AND "orderId" = l->>'orderId' AND "variantId" = e->>'variantId' AND "costMovementId" IS NULL;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF wanted = 0 OR n <> wanted THEN
        RAISE EXCEPTION 'COSTING_EXIT_LINES: % of % order lines took the cost of exit %', n, wanted, e->>'stockMovementId' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    entry_id := e->>'id';
    entry_sequence := seq;
    RETURN NEXT;
  END LOOP;
END $$;
