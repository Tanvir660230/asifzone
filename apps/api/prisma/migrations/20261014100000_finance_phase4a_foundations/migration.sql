-- Financial Core Phase 4A (docs/FINANCE_PHASE_4.md): supplier master, purchase tax codes, the inventory valuation ledger,
-- and purchase stock-movement reasons. Additive only: no existing row is changed.

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'INACTIVE');

-- CreateEnum
CREATE TYPE "InventoryValuationKind" AS ENUM ('CUTOVER', 'INFLOW', 'OUTFLOW', 'REVALUATION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementReason" ADD VALUE 'PURCHASE_RECEIPT';
ALTER TYPE "StockMovementReason" ADD VALUE 'PURCHASE_RETURN';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" JSONB,
    "taxId" TEXT,
    "vatRegistrationNo" TEXT,
    "currency" VARCHAR(3) NOT NULL,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "paymentTermsNote" TEXT,
    "creditLimit" DECIMAL(18,2),
    "defaultTaxCodeId" TEXT,
    "defaultExpenseAccountId" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "notes" TEXT,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCode" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rate" DECIMAL(7,4) NOT NULL,
    "recoverablePct" DECIMAL(7,4) NOT NULL,
    "recoverableMappingKey" TEXT NOT NULL DEFAULT 'asset.vat_input',
    "nonRecoverableMappingKey" TEXT NOT NULL DEFAULT 'expense.non_recoverable_tax',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryValuationEntry" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "stockMovementId" TEXT,
    "kind" "InventoryValuationKind" NOT NULL,
    "qtyChange" INTEGER NOT NULL,
    "valueChange" DECIMAL(18,2) NOT NULL,
    "bookValue" DECIMAL(18,2) NOT NULL,
    "costAdjustment" DECIMAL(18,2) NOT NULL,
    "unitCost" DECIMAL(18,6),
    "costBasis" TEXT NOT NULL,
    "valuationStatus" "FinanceValuationStatus" NOT NULL,
    "deficitQtyChange" INTEGER NOT NULL DEFAULT 0,
    "coveredQty" INTEGER NOT NULL DEFAULT 0,
    "unvaluedQtyChange" INTEGER NOT NULL DEFAULT 0,
    "qtyAfter" INTEGER NOT NULL,
    "valueAfter" DECIMAL(18,2) NOT NULL,
    "avgAfter" DECIMAL(18,6),
    "unvaluedAfter" INTEGER NOT NULL,
    "deficitAfter" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "financialDate" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryValuationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCostState" (
    "variantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "valuedQty" INTEGER NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "avgUnitCost" DECIMAL(18,6),
    "unvaluedQty" INTEGER NOT NULL,
    "deficitQty" INTEGER NOT NULL,
    "deficitLayers" JSONB NOT NULL,
    "lastEntryId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCostState_pkey" PRIMARY KEY ("variantId")
);

-- CreateIndex
CREATE INDEX "Supplier_businessId_status_idx" ON "Supplier"("businessId", "status");

-- CreateIndex
CREATE INDEX "Supplier_businessId_displayName_idx" ON "Supplier"("businessId", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_businessId_code_key" ON "Supplier"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCode_businessId_code_key" ON "TaxCode"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryValuationEntry_sequence_key" ON "InventoryValuationEntry"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryValuationEntry_stockMovementId_key" ON "InventoryValuationEntry"("stockMovementId");

-- CreateIndex
CREATE INDEX "InventoryValuationEntry_variantId_sequence_idx" ON "InventoryValuationEntry"("variantId", "sequence");

-- CreateIndex
CREATE INDEX "InventoryValuationEntry_sourceType_sourceId_idx" ON "InventoryValuationEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "InventoryValuationEntry_businessId_financialDate_idx" ON "InventoryValuationEntry"("businessId", "financialDate");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCostState_lastEntryId_key" ON "InventoryCostState"("lastEntryId");

-- CreateIndex
CREATE INDEX "StockMovement_sourceType_sourceId_idx" ON "StockMovement"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_defaultTaxCodeId_fkey" FOREIGN KEY ("defaultTaxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_defaultExpenseAccountId_fkey" FOREIGN KEY ("defaultExpenseAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryValuationEntry" ADD CONSTRAINT "InventoryValuationEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryValuationEntry" ADD CONSTRAINT "InventoryValuationEntry_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "FinanceBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryValuationEntry" ADD CONSTRAINT "InventoryValuationEntry_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryValuationEntry" ADD CONSTRAINT "InventoryValuationEntry_stockMovementId_fkey" FOREIGN KEY ("stockMovementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCostState" ADD CONSTRAINT "InventoryCostState_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCostState" ADD CONSTRAINT "InventoryCostState_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCostState" ADD CONSTRAINT "InventoryCostState_lastEntryId_fkey" FOREIGN KEY ("lastEntryId") REFERENCES "InventoryValuationEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Phase 4A invariants (docs/FINANCE_PHASE_4.md §27). Same conventions as Phases 1–3: business rules the database can
-- hold are held by it; maintenance purge (test databases only) is the one way around them.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- D-1 value checks
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{1,23}$');
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_terms_range" CHECK ("paymentTermsDays" BETWEEN 0 AND 365);
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_credit_limit_nonnegative" CHECK ("creditLimit" IS NULL OR "creditLimit" >= 0);
ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_rate_range" CHECK ("rate" >= 0 AND "rate" <= 100);
ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_recoverable_range" CHECK ("recoverablePct" >= 0 AND "recoverablePct" <= 100);

ALTER TABLE "InventoryValuationEntry" ADD CONSTRAINT "InventoryValuationEntry_adjustment_rule" CHECK ("costAdjustment" = "valueChange" - "bookValue");
ALTER TABLE "InventoryValuationEntry" ADD CONSTRAINT "InventoryValuationEntry_kind_qty" CHECK (
  ("kind" = 'INFLOW' AND "qtyChange" > 0) OR ("kind" = 'OUTFLOW' AND "qtyChange" < 0) OR ("kind" = 'REVALUATION' AND "qtyChange" = 0) OR "kind" = 'CUTOVER');
ALTER TABLE "InventoryValuationEntry" ADD CONSTRAINT "InventoryValuationEntry_after_nonnegative" CHECK (
  "qtyAfter" >= 0 AND "unvaluedAfter" >= 0 AND "deficitAfter" >= 0 AND "valueAfter" >= 0 AND ("qtyAfter" > 0 OR "valueAfter" = 0));
ALTER TABLE "InventoryValuationEntry" ADD CONSTRAINT "InventoryValuationEntry_parts" CHECK ("coveredQty" >= 0 AND "coveredQty" <= abs("qtyChange"));
ALTER TABLE "InventoryCostState" ADD CONSTRAINT "InventoryCostState_nonnegative" CHECK (
  "valuedQty" >= 0 AND "unvaluedQty" >= 0 AND "deficitQty" >= 0 AND "value" >= 0 AND ("valuedQty" > 0 OR "value" = 0));

-- D-2 suppliers and tax codes: identity is permanent; history is never deleted (deactivate instead)
CREATE OR REPLACE FUNCTION finance_supplier_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: suppliers are never deleted (mark them inactive)' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."businessId", NEW.code) IS DISTINCT FROM (OLD."businessId", OLD.code) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a supplier''s code never changes (it is the merge key)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Supplier_guard" BEFORE UPDATE OR DELETE ON "Supplier" FOR EACH ROW EXECUTE FUNCTION finance_supplier_guard();

CREATE OR REPLACE FUNCTION finance_tax_code_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: tax codes are never deleted (deactivate them)' USING ERRCODE = 'check_violation'; END IF;
  IF (NEW."businessId", NEW.code, NEW.rate, NEW."recoverablePct", NEW."recoverableMappingKey", NEW."nonRecoverableMappingKey")
     IS DISTINCT FROM (OLD."businessId", OLD.code, OLD.rate, OLD."recoverablePct", OLD."recoverableMappingKey", OLD."nonRecoverableMappingKey") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a tax code''s rate, recoverable share and accounts never change — create a new code' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TaxCode_guard" BEFORE UPDATE OR DELETE ON "TaxCode" FOR EACH ROW EXECUTE FUNCTION finance_tax_code_guard();

-- D-3 the valuation ledger: append-only, and every entry continues exactly from the variant's current cost state
CREATE OR REPLACE FUNCTION finance_valuation_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st "InventoryCostState"%ROWTYPE;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: valuation entries are append-only (post a new entry)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO st FROM "InventoryCostState" WHERE "variantId" = NEW."variantId";
  IF NOT FOUND THEN
    IF NEW.kind <> 'CUTOVER' AND (NEW."qtyAfter" - (NEW."qtyChange" - NEW."unvaluedQtyChange" + NEW."deficitQtyChange"), NEW."valueAfter" - NEW."valueChange",
                                  NEW."unvaluedAfter" - NEW."unvaluedQtyChange", NEW."deficitAfter" - NEW."deficitQtyChange") IS DISTINCT FROM (0, 0::numeric, 0, 0) THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: the first valuation entry of variant % must start from zero', NEW."variantId" USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.kind = 'CUTOVER' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: variant % already has valuation history — a cutover is its first entry only', NEW."variantId" USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW."qtyAfter" - (NEW."qtyChange" - NEW."unvaluedQtyChange" + NEW."deficitQtyChange"), NEW."valueAfter" - NEW."valueChange",
        NEW."unvaluedAfter" - NEW."unvaluedQtyChange", NEW."deficitAfter" - NEW."deficitQtyChange")
       IS DISTINCT FROM (st."valuedQty", st.value, st."unvaluedQty", st."deficitQty") THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: valuation entry for variant % does not continue from its cost state', NEW."variantId" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InventoryValuationEntry_guard" BEFORE INSERT OR UPDATE OR DELETE ON "InventoryValuationEntry"
  FOR EACH ROW EXECUTE FUNCTION finance_valuation_entry_guard();

-- D-4 the cost state is exactly its variant's latest entry (never edited independently, never deleted)
CREATE OR REPLACE FUNCTION finance_cost_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "InventoryValuationEntry"%ROWTYPE;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a variant''s cost state is never deleted' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO e FROM "InventoryValuationEntry" WHERE id = NEW."lastEntryId";
  IF NOT FOUND OR e."variantId" <> NEW."variantId" OR e."businessId" <> NEW."businessId"
     OR (e."qtyAfter", e."valueAfter", e."avgAfter", e."unvaluedAfter", e."deficitAfter") IS DISTINCT FROM (NEW."valuedQty", NEW.value, NEW."avgUnitCost", NEW."unvaluedQty", NEW."deficitQty") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: the cost state of variant % must equal its latest valuation entry', NEW."variantId" USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "InventoryValuationEntry" x WHERE x."variantId" = NEW."variantId" AND x.sequence > e.sequence) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: the cost state of variant % must point at its latest entry', NEW."variantId" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InventoryCostState_guard" BEFORE INSERT OR UPDATE OR DELETE ON "InventoryCostState"
  FOR EACH ROW EXECUTE FUNCTION finance_cost_state_guard();

-- D-5 audit atomicity (Phase 1 F-6) for the master data. The valuation ledger is not audited row by row: every entry is
-- tied 1:1 to its stock movement or source document (which carry their own audit), and it is append-only by D-3.
CREATE CONSTRAINT TRIGGER "Supplier_audit" AFTER INSERT OR UPDATE OR DELETE ON "Supplier"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('Supplier');
CREATE CONSTRAINT TRIGGER "TaxCode_audit" AFTER INSERT OR UPDATE OR DELETE ON "TaxCode"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('TaxCode');

-- D-6 no TRUNCATE (Phase 1 F-10)
CREATE TRIGGER "Supplier_no_truncate" BEFORE TRUNCATE ON "Supplier" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "TaxCode_no_truncate" BEFORE TRUNCATE ON "TaxCode" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "InventoryValuationEntry_no_truncate" BEFORE TRUNCATE ON "InventoryValuationEntry" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "InventoryCostState_no_truncate" BEFORE TRUNCATE ON "InventoryCostState" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
