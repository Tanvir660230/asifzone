-- Financial Core Phase 4C — the valuation cutover (docs/FINANCE_PHASE_4C.md).
--
-- One owner-approved batch per business gives every stock-tracked variant its first valuation (stock at post × approved
-- unit cost), trues the inventory account up through one ADJUSTMENT journal and activates costing, in one transaction.
--
-- Invariants added here:
--   C-1 a batch is DRAFT → APPROVED → POSTED (APPROVED may go back to DRAFT); POSTED is immutable and never deleted;
--   C-2 lines change only while their batch is a DRAFT — except, while APPROVED, the posting itself (posted columns, and
--       lines added at post for variants created since the draft) and cascades from deleting a variant with no history;
--       a posted line can never be removed, so a cut-over variant can't be hard-deleted;
--   C-3 MISSING ⇔ no unit cost; an opening-error amount needs a reason;
--   C-4 audit entry at commit for every batch change (Phase 1 F-6), no TRUNCATE (F-10).

-- CreateEnum
CREATE TYPE "InventoryCutoverStatus" AS ENUM ('DRAFT', 'APPROVED', 'POSTED');

-- AlterEnum
ALTER TYPE "JournalEntryKind" ADD VALUE 'ADJUSTMENT';

-- CreateTable
CREATE TABLE "InventoryCutoverBatch" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "status" "InventoryCutoverStatus" NOT NULL DEFAULT 'DRAFT',
    "cutoverDate" DATE NOT NULL,
    "notes" TEXT,
    "openingErrorAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openingErrorReason" TEXT,
    "approvedFingerprint" TEXT,
    "createdByAdminId" TEXT,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedByAdminId" TEXT,
    "postedAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCutoverBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCutoverLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitCost" DECIMAL(18,2),
    "valuationStatus" "FinanceValuationStatus" NOT NULL,
    "costSource" TEXT NOT NULL,
    "evidence" TEXT,
    "draftQuantity" INTEGER NOT NULL,
    "postedQuantity" INTEGER,
    "postedValue" DECIMAL(18,2),
    "valuationEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCutoverLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCutoverBatch_businessId_key" ON "InventoryCutoverBatch"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCutoverBatch_journalEntryId_key" ON "InventoryCutoverBatch"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCutoverLine_valuationEntryId_key" ON "InventoryCutoverLine"("valuationEntryId");

-- CreateIndex
CREATE INDEX "InventoryCutoverLine_batchId_valuationStatus_idx" ON "InventoryCutoverLine"("batchId", "valuationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCutoverLine_batchId_variantId_key" ON "InventoryCutoverLine"("batchId", "variantId");

-- AddForeignKey
ALTER TABLE "InventoryCutoverBatch" ADD CONSTRAINT "InventoryCutoverBatch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCutoverBatch" ADD CONSTRAINT "InventoryCutoverBatch_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "FinanceBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCutoverBatch" ADD CONSTRAINT "InventoryCutoverBatch_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCutoverLine" ADD CONSTRAINT "InventoryCutoverLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryCutoverBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCutoverLine" ADD CONSTRAINT "InventoryCutoverLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- C-3
ALTER TABLE "InventoryCutoverBatch" ADD CONSTRAINT "InventoryCutoverBatch_opening_error_reason"
  CHECK ("openingErrorAmount" = 0 OR length(btrim(coalesce("openingErrorReason", ''))) > 0);
ALTER TABLE "InventoryCutoverBatch" ADD CONSTRAINT "InventoryCutoverBatch_posted_fields"
  CHECK (("status" = 'POSTED') = ("postedAt" IS NOT NULL) AND ("status" = 'DRAFT' OR "approvedAt" IS NOT NULL));
ALTER TABLE "InventoryCutoverLine" ADD CONSTRAINT "InventoryCutoverLine_values" CHECK (
  "valuationStatus" IN ('KNOWN', 'ESTIMATED', 'MISSING')
  AND ("unitCost" IS NULL OR "unitCost" >= 0)
  AND (("valuationStatus" = 'MISSING') = ("unitCost" IS NULL))
  AND ("postedValue" IS NULL OR "postedValue" >= 0)
  AND (("postedQuantity" IS NULL) = ("postedValue" IS NULL)));

-- C-1
CREATE OR REPLACE FUNCTION finance_cutover_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: only a draft valuation cutover can be deleted' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a posted valuation cutover is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (('DRAFT', 'APPROVED'), ('APPROVED', 'DRAFT'), ('APPROVED', 'POSTED'))) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a valuation cutover can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."businessId" <> OLD."businessId" THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a cutover belongs to one business' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InventoryCutoverBatch_guard" BEFORE UPDATE OR DELETE ON "InventoryCutoverBatch"
  FOR EACH ROW EXECUTE FUNCTION finance_cutover_batch_guard();

-- C-2
CREATE OR REPLACE FUNCTION finance_cutover_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO s FROM "InventoryCutoverBatch" WHERE id = COALESCE(NEW."batchId", OLD."batchId");
  IF s = 'DRAFT' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF s = 'APPROVED' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; -- a variant with no history removed after approval (the fingerprint then refuses the post)
    IF TG_OP = 'INSERT' AND NEW."costSource" = 'ADDED_AT_POST' AND NEW."valuationStatus" = 'MISSING' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND (NEW."batchId", NEW."variantId", NEW.sku, NEW.name, NEW."unitCost", NEW."valuationStatus", NEW."costSource", NEW.evidence, NEW."draftQuantity")
       IS NOT DISTINCT FROM (OLD."batchId", OLD."variantId", OLD.sku, OLD.name, OLD."unitCost", OLD."valuationStatus", OLD."costSource", OLD.evidence, OLD."draftQuantity") THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FINANCE_INVARIANT: an approved valuation cutover''s lines are frozen (send it back to draft to change them)' USING ERRCODE = 'check_violation';
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: a posted valuation cutover is immutable' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "InventoryCutoverLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "InventoryCutoverLine"
  FOR EACH ROW EXECUTE FUNCTION finance_cutover_line_guard();

-- C-4
CREATE CONSTRAINT TRIGGER "InventoryCutoverBatch_audit" AFTER INSERT OR UPDATE OR DELETE ON "InventoryCutoverBatch"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('InventoryCutoverBatch');
CREATE TRIGGER "InventoryCutoverBatch_no_truncate" BEFORE TRUNCATE ON "InventoryCutoverBatch" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "InventoryCutoverLine_no_truncate" BEFORE TRUNCATE ON "InventoryCutoverLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
