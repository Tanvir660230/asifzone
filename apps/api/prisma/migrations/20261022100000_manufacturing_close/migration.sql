-- Manufacturing M5 — close, final cost, abnormal loss, late costs (docs/MANUFACTURING.md §9)

-- CreateEnum
CREATE TYPE "ProductionSettlementKind" AS ENUM ('CLOSE', 'LATE_COST');

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN "closedByAdminId" TEXT;

-- CreateTable
CREATE TABLE "ProductionSettlement" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "kind" "ProductionSettlementKind" NOT NULL,
    "costEntryId" TEXT,
    "residual" DECIMAL(18,2) NOT NULL,
    "transfer" DECIMAL(18,2) NOT NULL,
    "abnormalLoss" DECIMAL(18,2) NOT NULL,
    "abnormalLossReason" TEXT,
    "financialDate" DATE NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionSettlementLine" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "delta" DECIMAL(18,2) NOT NULL,
    "heldShare" DECIMAL(18,2) NOT NULL,
    "soldShare" DECIMAL(18,2) NOT NULL,
    "valuationEntryId" TEXT,

    CONSTRAINT "ProductionSettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionSettlement_productionOrderId_idx" ON "ProductionSettlement"("productionOrderId");
CREATE INDEX "ProductionSettlement_costEntryId_idx" ON "ProductionSettlement"("costEntryId");
CREATE INDEX "ProductionSettlementLine_variantId_idx" ON "ProductionSettlementLine"("variantId");
CREATE UNIQUE INDEX "ProductionSettlementLine_settlementId_variantId_key" ON "ProductionSettlementLine"("settlementId", "variantId");

-- AddForeignKey
ALTER TABLE "ProductionSettlement" ADD CONSTRAINT "ProductionSettlement_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionSettlement" ADD CONSTRAINT "ProductionSettlement_costEntryId_fkey" FOREIGN KEY ("costEntryId") REFERENCES "ProductionCostEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionSettlementLine" ADD CONSTRAINT "ProductionSettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "ProductionSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionSettlementLine" ADD CONSTRAINT "ProductionSettlementLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- S-1 values: residual = transfer + abnormal loss; a loss is never negative and always carries its reason; one close per
--     order; a late cost names its cost entry; a line's delta = held share + sold share
ALTER TABLE "ProductionSettlement" ADD CONSTRAINT "ProductionSettlement_values" CHECK (
  "residual" = "transfer" + "abnormalLoss" AND "abnormalLoss" >= 0 AND (("abnormalLoss" > 0) = ("abnormalLossReason" IS NOT NULL))
  AND (("kind" = 'LATE_COST') = ("costEntryId" IS NOT NULL)));
CREATE UNIQUE INDEX "ProductionSettlement_one_close" ON "ProductionSettlement"("productionOrderId") WHERE "kind" = 'CLOSE';
ALTER TABLE "ProductionSettlementLine" ADD CONSTRAINT "ProductionSettlementLine_values" CHECK (
  "qty" > 0 AND "delta" = "heldShare" + "soldShare");

-- S-2 append-only: a settlement and its lines are never changed or deleted
CREATE OR REPLACE FUNCTION mfg_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: a production settlement is append-only' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "ProductionSettlement_guard" BEFORE UPDATE OR DELETE ON "ProductionSettlement" FOR EACH ROW EXECUTE FUNCTION mfg_settlement_guard();
CREATE TRIGGER "ProductionSettlementLine_guard" BEFORE UPDATE OR DELETE ON "ProductionSettlementLine" FOR EACH ROW EXECUTE FUNCTION mfg_settlement_guard();

-- S-3 a CLOSE settlement is written in the transaction that closes the order (its order is CLOSED at commit); a LATE_COST
--     only for a closed order
CREATE OR REPLACE FUNCTION mfg_settlement_order_closed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "ProductionOrder" WHERE id = NEW."productionOrderId";
  IF st <> 'CLOSED' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a production settlement belongs to a closed order (it is %)', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ProductionSettlement_order_closed" AFTER INSERT ON "ProductionSettlement"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mfg_settlement_order_closed();

-- the order's close: a CLOSED order carries when it closed (a cancellation stamps closedAt too)
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_closed_fields" CHECK ("status" <> 'CLOSED' OR "closedAt" IS NOT NULL);

-- late costs: a cost may be entered (as a draft) on a closed order; approving or voiding it settles at once
CREATE OR REPLACE FUNCTION mfg_cost_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: an approved production cost is never deleted (void it)' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a production cost starts as a draft' USING ERRCODE = 'check_violation'; END IF;
    SELECT status INTO st FROM "ProductionOrder" WHERE id = NEW."productionOrderId";
    IF st NOT IN ('APPROVED', 'IN_PRODUCTION', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: costs are entered on an approved production order (it is %)', st USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'VOID' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a void production cost is final' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (('DRAFT', 'APPROVED'), ('DRAFT', 'VOID'), ('APPROVED', 'VOID'))) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a production cost can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status = 'DRAFT' AND NEW."approvedByAdminId" IS NOT DISTINCT FROM OLD."createdByAdminId" AND OLD."createdByAdminId" IS NOT NULL THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a production cost is approved by someone other than who entered it' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'APPROVED' AND (NEW."productionOrderId", NEW."categoryId", NEW."supplierId", NEW.reference, NEW.description, NEW."costDate", NEW.quantity, NEW."unitRate", NEW.amount, NEW."approvedByAdminId", NEW."approvedAt")
     IS DISTINCT FROM (OLD."productionOrderId", OLD."categoryId", OLD."supplierId", OLD.reference, OLD.description, OLD."costDate", OLD.quantity, OLD."unitRate", OLD.amount, OLD."approvedByAdminId", OLD."approvedAt") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: an approved production cost is immutable (void it and enter it again)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- S-4 audit at commit, no TRUNCATE
CREATE CONSTRAINT TRIGGER "ProductionSettlement_audit" AFTER INSERT OR UPDATE OR DELETE ON "ProductionSettlement"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('ProductionSettlement');
CREATE TRIGGER "ProductionSettlement_no_truncate" BEFORE TRUNCATE ON "ProductionSettlement" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "ProductionSettlementLine_no_truncate" BEFORE TRUNCATE ON "ProductionSettlementLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
