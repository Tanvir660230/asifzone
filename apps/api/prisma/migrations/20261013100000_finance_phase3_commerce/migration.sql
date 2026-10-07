-- Financial Core Phase 3 (docs/FINANCE_PHASE_3.md): finance roles, sensitive accounts, cost policy, finance exceptions,
-- clearing settlements and the commerce projector state. Additive only.

-- CreateEnum
CREATE TYPE "FinanceCostPolicy" AS ENUM ('KNOWN_ONLY', 'APPROVED_ESTIMATES');

-- CreateEnum
CREATE TYPE "FinanceExceptionKind" AS ENUM ('MISSING_COST', 'ORDER_TOTAL_MISMATCH', 'UNVALUED_STOCK_RECEIPT', 'UNVALUED_STOCK_WRITE_OFF', 'UNSUPPORTED_CREDIT_ENTRY', 'UNMATCHED_SETTLEMENT_LINE', 'ENGINE_MISMATCH');

-- CreateEnum
CREATE TYPE "FinanceExceptionStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ClearingSettlementStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ClearingSettlementSource" AS ENUM ('MANUAL', 'CSV_IMPORT');

-- CreateEnum
CREATE TYPE "SettlementLineMatch" AS ENUM ('MATCHED', 'UNMATCHED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminRole" ADD VALUE 'FINANCE_ADMIN';
ALTER TYPE "AdminRole" ADD VALUE 'ACCOUNTANT';
ALTER TYPE "AdminRole" ADD VALUE 'FINANCE_VIEWER';

-- AlterTable
ALTER TABLE "FinanceBusiness" ADD COLUMN     "costPolicy" "FinanceCostPolicy" NOT NULL DEFAULT 'KNOWN_ONLY';

-- AlterTable
ALTER TABLE "LedgerAccount" ADD COLUMN     "isSensitive" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FinanceException" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT,
    "kind" "FinanceExceptionKind" NOT NULL,
    "status" "FinanceExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "key" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "title" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "amount" DECIMAL(18,2),
    "resolution" TEXT,
    "resolutionNote" TEXT,
    "estimatedUnitCost" DECIMAL(18,2),
    "resolvedByAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "financialEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearingSettlement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT,
    "clearingFinancialAccountId" TEXT NOT NULL,
    "destinationFinancialAccountId" TEXT NOT NULL,
    "settlementDate" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "feeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustmentAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustmentReason" TEXT,
    "evidence" TEXT,
    "source" "ClearingSettlementSource" NOT NULL,
    "fileHash" TEXT,
    "status" "ClearingSettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "journalEntryId" TEXT,
    "reversalJournalEntryId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdByAdminId" TEXT,
    "postedByAdminId" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversedByAdminId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClearingSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearingSettlementLine" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "externalRef" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustment" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "matchStatus" "SettlementLineMatch" NOT NULL,
    "note" TEXT,

    CONSTRAINT "ClearingSettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceSyncState" (
    "businessId" TEXT NOT NULL,
    "cursor" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastRunStats" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceSyncState_pkey" PRIMARY KEY ("businessId")
);

-- CreateIndex
CREATE INDEX "FinanceException_businessId_status_kind_idx" ON "FinanceException"("businessId", "status", "kind");

-- CreateIndex
CREATE INDEX "FinanceException_orderId_idx" ON "FinanceException"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceException_businessId_key_key" ON "FinanceException"("businessId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ClearingSettlement_journalEntryId_key" ON "ClearingSettlement"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "ClearingSettlement_reversalJournalEntryId_key" ON "ClearingSettlement"("reversalJournalEntryId");

-- CreateIndex
CREATE INDEX "ClearingSettlement_businessId_status_idx" ON "ClearingSettlement"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClearingSettlement_businessId_idempotencyKey_key" ON "ClearingSettlement"("businessId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClearingSettlement_clearingFinancialAccountId_reference_key" ON "ClearingSettlement"("clearingFinancialAccountId", "reference");

-- CreateIndex
CREATE INDEX "ClearingSettlementLine_orderId_idx" ON "ClearingSettlementLine"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ClearingSettlementLine_settlementId_lineNo_key" ON "ClearingSettlementLine"("settlementId", "lineNo");

-- AddForeignKey
ALTER TABLE "FinanceException" ADD CONSTRAINT "FinanceException_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearingSettlement" ADD CONSTRAINT "ClearingSettlement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearingSettlement" ADD CONSTRAINT "ClearingSettlement_clearingFinancialAccountId_fkey" FOREIGN KEY ("clearingFinancialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearingSettlement" ADD CONSTRAINT "ClearingSettlement_destinationFinancialAccountId_fkey" FOREIGN KEY ("destinationFinancialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearingSettlement" ADD CONSTRAINT "ClearingSettlement_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearingSettlement" ADD CONSTRAINT "ClearingSettlement_reversalJournalEntryId_fkey" FOREIGN KEY ("reversalJournalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearingSettlementLine" ADD CONSTRAINT "ClearingSettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "ClearingSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceSyncState" ADD CONSTRAINT "FinanceSyncState_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Financial Core Phase 3 invariants (docs/FINANCE_PHASE_3.md §10). Same conventions as Phases 1–2.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- C-1 a settlement balances by construction: what left clearing = what arrived + the actual fee + the actual adjustment
ALTER TABLE "ClearingSettlement" ADD CONSTRAINT "ClearingSettlement_amounts" CHECK (
  "grossAmount" > 0 AND "netAmount" >= 0 AND "feeAmount" >= 0 AND "grossAmount" = "netAmount" + "feeAmount" + "adjustmentAmount"
  AND ("adjustmentAmount" = 0 OR "adjustmentReason" IS NOT NULL)
  AND "clearingFinancialAccountId" <> "destinationFinancialAccountId"
);
ALTER TABLE "ClearingSettlement" ADD CONSTRAINT "ClearingSettlement_status_journal" CHECK (
  ("status" IN ('POSTED', 'REVERSED')) = ("journalEntryId" IS NOT NULL) AND ("status" = 'REVERSED') = ("reversalJournalEntryId" IS NOT NULL)
);
ALTER TABLE "ClearingSettlementLine" ADD CONSTRAINT "ClearingSettlementLine_amounts" CHECK ("amount" > 0 AND "fee" >= 0);

-- C-2 a posted settlement is immutable except POSTED → REVERSED; at posting its lines (if any) add up to it
CREATE OR REPLACE FUNCTION finance_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int; s_amount numeric; s_fee numeric; s_adj numeric;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: settlement % is posted history and cannot be deleted', OLD.id USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a settlement starts as a DRAFT' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'REVERSED' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: reversed settlement % is final', OLD.id USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED' OR (NEW."businessId", NEW."clearingFinancialAccountId", NEW."destinationFinancialAccountId", NEW."settlementDate", NEW.reference,
        NEW."grossAmount", NEW."netAmount", NEW."feeAmount", NEW."adjustmentAmount", NEW."journalEntryId", NEW."idempotencyKey")
       IS DISTINCT FROM (OLD."businessId", OLD."clearingFinancialAccountId", OLD."destinationFinancialAccountId", OLD."settlementDate", OLD.reference,
        OLD."grossAmount", OLD."netAmount", OLD."feeAmount", OLD."adjustmentAmount", OLD."journalEntryId", OLD."idempotencyKey") THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: posted settlement % is immutable (reverse it instead)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'POSTED' THEN
    SELECT count(*), coalesce(sum(amount), 0), coalesce(sum(fee), 0), coalesce(sum(adjustment), 0) INTO n, s_amount, s_fee, s_adj
      FROM "ClearingSettlementLine" WHERE "settlementId" = NEW.id;
    IF n > 0 AND (s_amount <> NEW."grossAmount" OR s_fee <> NEW."feeAmount" OR s_adj <> NEW."adjustmentAmount") THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: settlement % lines (%/%/%) differ from its totals', NEW.id, s_amount, s_fee, s_adj USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'REVERSED' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: only a posted settlement can be reversed' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClearingSettlement_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ClearingSettlement"
  FOR EACH ROW EXECUTE FUNCTION finance_settlement_guard();

CREATE OR REPLACE FUNCTION finance_settlement_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO st FROM "ClearingSettlement" WHERE id = COALESCE(NEW."settlementId", OLD."settlementId");
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: the lines of a posted settlement are history' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "ClearingSettlementLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ClearingSettlementLine"
  FOR EACH ROW EXECUTE FUNCTION finance_settlement_line_guard();

-- C-3 an exception is never deleted; its identity never changes; RESOLVED is final
CREATE OR REPLACE FUNCTION finance_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: finance exceptions are history and are never deleted' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF (NEW."businessId", NEW.kind, NEW.key, NEW."sourceType", NEW."sourceId") IS DISTINCT FROM (OLD."businessId", OLD.kind, OLD.key, OLD."sourceType", OLD."sourceId") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: an exception''s identity never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'RESOLVED' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: resolved exception % is final', OLD.id USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FinanceException_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceException"
  FOR EACH ROW EXECUTE FUNCTION finance_exception_guard();

-- C-4 audit atomicity (Phase 1 F-6)
CREATE CONSTRAINT TRIGGER "FinanceException_audit" AFTER INSERT OR UPDATE OR DELETE ON "FinanceException"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('FinanceException');
CREATE CONSTRAINT TRIGGER "ClearingSettlement_audit" AFTER INSERT OR UPDATE OR DELETE ON "ClearingSettlement"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('ClearingSettlement');
CREATE CONSTRAINT TRIGGER "ClearingSettlementLine_audit" AFTER INSERT OR UPDATE OR DELETE ON "ClearingSettlementLine"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('ClearingSettlementLine');

-- C-5 no TRUNCATE (Phase 1 F-10)
CREATE TRIGGER "FinanceException_no_truncate" BEFORE TRUNCATE ON "FinanceException" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "ClearingSettlement_no_truncate" BEFORE TRUNCATE ON "ClearingSettlement" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "ClearingSettlementLine_no_truncate" BEFORE TRUNCATE ON "ClearingSettlementLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
