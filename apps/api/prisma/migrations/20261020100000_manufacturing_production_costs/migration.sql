-- Manufacturing M3 — production costs (docs/MANUFACTURING.md §7): actual costs per order and category, approved by a
-- second person, accrued into work in progress (Dr 1630 / Cr 2116) and voided by reversal.
--   C-1 values;  C-2 one live entry per supplier reference and category;  C-3 lifecycle, immutability, approver ≠ enterer;
--   C-4 audit at commit, no TRUNCATE.

-- CreateEnum
CREATE TYPE "ProductionCostStatus" AS ENUM ('DRAFT', 'APPROVED', 'VOID');

-- CreateTable
CREATE TABLE "ProductionCostEntry" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "supplierId" TEXT,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "costDate" DATE NOT NULL,
    "quantity" DECIMAL(18,4),
    "unitRate" DECIMAL(18,6),
    "amount" DECIMAL(18,2) NOT NULL,
    "evidence" TEXT,
    "status" "ProductionCostStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByAdminId" TEXT,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "voidedByAdminId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionCostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionCostEntry_productionOrderId_status_idx" ON "ProductionCostEntry"("productionOrderId", "status");

-- CreateIndex
CREATE INDEX "ProductionCostEntry_supplierId_idx" ON "ProductionCostEntry"("supplierId");

-- AddForeignKey
ALTER TABLE "ProductionCostEntry" ADD CONSTRAINT "ProductionCostEntry_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCostEntry" ADD CONSTRAINT "ProductionCostEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductionCostCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCostEntry" ADD CONSTRAINT "ProductionCostEntry_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- C-1 values: a positive amount; quantity and rate come together; a void carries its reason; approval fields follow status
ALTER TABLE "ProductionCostEntry" ADD CONSTRAINT "ProductionCostEntry_values" CHECK (
  "amount" > 0 AND (("quantity" IS NULL) = ("unitRate" IS NULL)) AND ("quantity" IS NULL OR ("quantity" > 0 AND "unitRate" >= 0))
  AND (("status" = 'VOID') = ("voidedAt" IS NOT NULL)) AND ("status" = 'VOID' OR "voidReason" IS NULL)
  AND ("status" = 'DRAFT' OR "approvedAt" IS NOT NULL OR "status" = 'VOID'));

-- C-2 no double capture: one live entry per supplier reference and category
CREATE UNIQUE INDEX "ProductionCostEntry_live_reference_key" ON "ProductionCostEntry" ("supplierId", "categoryId", lower(btrim("reference")))
  WHERE "reference" IS NOT NULL AND "supplierId" IS NOT NULL AND "status" <> 'VOID';

-- C-3 lifecycle: DRAFT → APPROVED → VOID (or DRAFT → VOID); an approved cost is immutable except voiding; only drafts deleted;
--     the approver is never the person who entered it
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
    IF st NOT IN ('APPROVED', 'IN_PRODUCTION', 'PARTIALLY_RECEIVED', 'RECEIVED') THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: costs are entered on an approved, open production order (it is %)', st USING ERRCODE = 'check_violation';
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
CREATE TRIGGER "ProductionCostEntry_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProductionCostEntry" FOR EACH ROW EXECUTE FUNCTION mfg_cost_entry_guard();

-- C-4 audit at commit, no TRUNCATE
CREATE CONSTRAINT TRIGGER "ProductionCostEntry_audit" AFTER INSERT OR UPDATE OR DELETE ON "ProductionCostEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('ProductionCostEntry');
CREATE TRIGGER "ProductionCostEntry_no_truncate" BEFORE TRUNCATE ON "ProductionCostEntry" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
