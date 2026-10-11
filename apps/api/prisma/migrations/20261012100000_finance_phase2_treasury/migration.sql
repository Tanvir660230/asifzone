-- Financial Core Phase 2 (docs/FINANCE_PHASE_2.md): cash, bank, wallets, statement lines, matching, statement imports and
-- bank reconciliations. Additive only.

-- CreateEnum
CREATE TYPE "TreasuryMovementKind" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'ADJUSTMENT', 'OPENING_FUNDING');

-- CreateEnum
CREATE TYPE "TreasuryMovementStatus" AS ENUM ('PENDING_APPROVAL', 'POSTED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "TreasuryDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "BankTransactionSource" AS ENUM ('MANUAL', 'CSV_IMPORT');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'ADJUSTMENT_REQUIRED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "BankMatchStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- AlterEnum
ALTER TYPE "JournalEntryKind" ADD VALUE 'TREASURY';

-- AlterTable
ALTER TABLE "FinancialAccount" ADD COLUMN     "accountReference" VARCHAR(64),
ADD COLUMN     "accountTitle" TEXT,
ADD COLUMN     "approvalThreshold" DECIMAL(18,2),
ADD COLUMN     "branch" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "reconciliationStartDate" DATE;

-- CreateTable
CREATE TABLE "TreasuryMovement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT,
    "kind" "TreasuryMovementKind" NOT NULL,
    "status" "TreasuryMovementStatus" NOT NULL,
    "direction" "TreasuryDirection",
    "movementDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "fromFinancialAccountId" TEXT,
    "toFinancialAccountId" TEXT,
    "counterAccountId" TEXT,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "reversalJournalEntryId" TEXT,
    "bankTransactionId" TEXT,
    "reconciliationId" TEXT,
    "requestedByAdminId" TEXT,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByAdminId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reversedByAdminId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "transactionDate" DATE NOT NULL,
    "valueDate" DATE,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "externalId" TEXT,
    "statementBalance" DECIMAL(18,2),
    "source" "BankTransactionSource" NOT NULL,
    "importId" TEXT,
    "importLine" INTEGER,
    "dedupeKey" TEXT NOT NULL,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustmentRequired" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "reconciliationId" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransactionMatch" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "journalLineId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "BankMatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchedByAdminId" TEXT,
    "reconciliationId" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "adjustmentMovementId" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedByAdminId" TEXT,
    "removalReason" TEXT,

    CONSTRAINT "BankTransactionMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementImport" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "fileName" TEXT,
    "fileHash" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "errors" JSONB NOT NULL,
    "importedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "openingStatementBalance" DECIMAL(18,2) NOT NULL,
    "closingStatementBalance" DECIMAL(18,2) NOT NULL,
    "ledgerOpeningBalance" DECIMAL(18,2),
    "ledgerBalance" DECIMAL(18,2),
    "statementMovement" DECIMAL(18,2),
    "difference" DECIMAL(18,2),
    "unexplainedDifference" DECIMAL(18,2),
    "statementGap" DECIMAL(18,2),
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "outstandingLedgerCount" INTEGER NOT NULL DEFAULT 0,
    "adjustmentCount" INTEGER NOT NULL DEFAULT 0,
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "startedByAdminId" TEXT,
    "completedByAdminId" TEXT,
    "completedAt" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),
    "abandonReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryMovement_journalEntryId_key" ON "TreasuryMovement"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryMovement_reversalJournalEntryId_key" ON "TreasuryMovement"("reversalJournalEntryId");

-- CreateIndex
CREATE INDEX "TreasuryMovement_fromFinancialAccountId_movementDate_idx" ON "TreasuryMovement"("fromFinancialAccountId", "movementDate");

-- CreateIndex
CREATE INDEX "TreasuryMovement_toFinancialAccountId_movementDate_idx" ON "TreasuryMovement"("toFinancialAccountId", "movementDate");

-- CreateIndex
CREATE INDEX "TreasuryMovement_businessId_status_idx" ON "TreasuryMovement"("businessId", "status");

-- CreateIndex
CREATE INDEX "TreasuryMovement_bankTransactionId_idx" ON "TreasuryMovement"("bankTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryMovement_businessId_idempotencyKey_key" ON "TreasuryMovement"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BankTransaction_financialAccountId_transactionDate_idx" ON "BankTransaction"("financialAccountId", "transactionDate");

-- CreateIndex
CREATE INDEX "BankTransaction_businessId_status_idx" ON "BankTransaction"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_financialAccountId_dedupeKey_key" ON "BankTransaction"("financialAccountId", "dedupeKey");

-- CreateIndex
CREATE INDEX "BankTransactionMatch_bankTransactionId_idx" ON "BankTransactionMatch"("bankTransactionId");

-- CreateIndex
CREATE INDEX "BankTransactionMatch_journalLineId_idx" ON "BankTransactionMatch"("journalLineId");

-- CreateIndex
CREATE UNIQUE INDEX "StatementImport_financialAccountId_fileHash_key" ON "StatementImport"("financialAccountId", "fileHash");

-- CreateIndex
CREATE INDEX "BankReconciliation_financialAccountId_periodStart_idx" ON "BankReconciliation"("financialAccountId", "periodStart");

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_fromFinancialAccountId_fkey" FOREIGN KEY ("fromFinancialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_toFinancialAccountId_fkey" FOREIGN KEY ("toFinancialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_counterAccountId_fkey" FOREIGN KEY ("counterAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_reversalJournalEntryId_fkey" FOREIGN KEY ("reversalJournalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "BankReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "StatementImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "BankReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "JournalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "BankReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_adjustmentMovementId_fkey" FOREIGN KEY ("adjustmentMovementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Financial Core Phase 2 invariants (docs/FINANCE_PHASE_2.md §8). Same conventions as Phase 1: FINANCE_INVARIANT errors,
-- finance_purge_allowed() for test databases only, finance_require_audit() for audit atomicity.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- T-1 shapes and amounts
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_shape" CHECK (
  CASE "kind"
    WHEN 'DEPOSIT' THEN "toFinancialAccountId" IS NOT NULL AND "fromFinancialAccountId" IS NULL AND "counterAccountId" IS NOT NULL AND "direction" IS NULL
    WHEN 'OPENING_FUNDING' THEN "toFinancialAccountId" IS NOT NULL AND "fromFinancialAccountId" IS NULL AND "counterAccountId" IS NOT NULL AND "direction" IS NULL
    WHEN 'WITHDRAWAL' THEN "fromFinancialAccountId" IS NOT NULL AND "toFinancialAccountId" IS NULL AND "counterAccountId" IS NOT NULL AND "direction" IS NULL
    WHEN 'TRANSFER' THEN "fromFinancialAccountId" IS NOT NULL AND "toFinancialAccountId" IS NOT NULL AND "fromFinancialAccountId" <> "toFinancialAccountId" AND "counterAccountId" IS NULL AND "direction" IS NULL
    WHEN 'ADJUSTMENT' THEN "counterAccountId" IS NOT NULL AND (
      ("direction" = 'IN' AND "toFinancialAccountId" IS NOT NULL AND "fromFinancialAccountId" IS NULL) OR
      ("direction" = 'OUT' AND "fromFinancialAccountId" IS NOT NULL AND "toFinancialAccountId" IS NULL))
  END
);
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_status_journal" CHECK (
  ("status" IN ('POSTED', 'REVERSED')) = ("journalEntryId" IS NOT NULL) AND ("status" = 'REVERSED') = ("reversalJournalEntryId" IS NOT NULL)
);
-- An account has at most one live opening funding.
CREATE UNIQUE INDEX "TreasuryMovement_one_opening_funding" ON "TreasuryMovement" ("toFinancialAccountId")
  WHERE "kind" = 'OPENING_FUNDING' AND "status" IN ('PENDING_APPROVAL', 'POSTED');

ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_amounts" CHECK (
  "debit" >= 0 AND "credit" >= 0 AND (("debit" > 0) <> ("credit" > 0)) AND "amount" = "credit" - "debit"
  AND "matchedAmount" >= 0 AND "matchedAmount" <= abs("amount")
  AND ("reconciliationId" IS NULL OR "matchedAmount" = abs("amount"))
);
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_period" CHECK ("periodStart" <= "periodEnd");
CREATE UNIQUE INDEX "BankReconciliation_one_in_progress" ON "BankReconciliation" ("financialAccountId") WHERE "status" = 'IN_PROGRESS';

-- T-2 a movement is immutable except its status, which only moves forward
CREATE OR REPLACE FUNCTION finance_treasury_movement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: treasury movement % cannot be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('PENDING_APPROVAL', 'POSTED') THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: a movement starts PENDING_APPROVAL or POSTED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."businessId", NEW.kind, NEW.direction, NEW."movementDate", NEW.amount, NEW.currency, NEW."fromFinancialAccountId", NEW."toFinancialAccountId",
      NEW."counterAccountId", NEW."idempotencyKey", NEW.fingerprint, NEW."bankTransactionId")
     IS DISTINCT FROM
     (OLD."businessId", OLD.kind, OLD.direction, OLD."movementDate", OLD.amount, OLD.currency, OLD."fromFinancialAccountId", OLD."toFinancialAccountId",
      OLD."counterAccountId", OLD."idempotencyKey", OLD.fingerprint, OLD."bankTransactionId") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: treasury movement % is immutable (reverse it instead)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."journalEntryId" IS NOT NULL AND NEW."journalEntryId" IS DISTINCT FROM OLD."journalEntryId" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a movement''s journal never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (OLD.status = NEW.status
          OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status IN ('POSTED', 'REJECTED'))
          OR (OLD.status = 'POSTED' AND NEW.status = 'REVERSED')) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: movement % can''t go from % to %', OLD.id, OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('REJECTED', 'REVERSED') THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: % movement % is final', OLD.status, OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TreasuryMovement_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TreasuryMovement"
  FOR EACH ROW EXECUTE FUNCTION finance_treasury_movement_guard();

-- T-3 statement lines: financial fields immutable; status derived; RECONCILED is final; only an untouched manual line may go
CREATE OR REPLACE FUNCTION finance_bank_transaction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.source <> 'MANUAL' OR OLD."matchedAmount" <> 0 OR OLD."reconciliationId" IS NOT NULL
       OR EXISTS (SELECT 1 FROM "BankTransactionMatch" WHERE "bankTransactionId" = OLD.id)
       OR EXISTS (SELECT 1 FROM "TreasuryMovement" WHERE "bankTransactionId" = OLD.id) THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: statement line % has history and cannot be deleted', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."businessId", NEW."financialAccountId", NEW."transactionDate", NEW."valueDate", NEW.reference, NEW.description, NEW.debit, NEW.credit,
        NEW.amount, NEW.currency, NEW."externalId", NEW."statementBalance", NEW.source, NEW."importId", NEW."importLine", NEW."dedupeKey")
       IS DISTINCT FROM
       (OLD."businessId", OLD."financialAccountId", OLD."transactionDate", OLD."valueDate", OLD.reference, OLD.description, OLD.debit, OLD.credit,
        OLD.amount, OLD.currency, OLD."externalId", OLD."statementBalance", OLD.source, OLD."importId", OLD."importLine", OLD."dedupeKey") THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: statement line % is evidence and never changes', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."reconciliationId" IS NOT NULL THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: statement line % is reconciled and final', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."matchedAmount" <> 0 OR NEW."reconciliationId" IS NOT NULL THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a statement line starts unmatched' USING ERRCODE = 'check_violation';
  END IF;
  NEW.status := CASE
    WHEN NEW."reconciliationId" IS NOT NULL THEN 'RECONCILED'
    WHEN NEW."matchedAmount" = abs(NEW.amount) THEN 'MATCHED'
    WHEN NEW."adjustmentRequired" THEN 'ADJUSTMENT_REQUIRED'
    WHEN NEW."matchedAmount" > 0 THEN 'PARTIALLY_MATCHED'
    ELSE 'UNMATCHED' END::"BankTransactionStatus";
  RETURN NEW;
END $$;
CREATE TRIGGER "BankTransaction_guard" BEFORE INSERT OR UPDATE OR DELETE ON "BankTransaction"
  FOR EACH ROW EXECUTE FUNCTION finance_bank_transaction_guard();

-- T-4 matches: same account, posted line, same direction, never more than either side's amount; only ACTIVE → REMOVED
CREATE OR REPLACE FUNCTION finance_bank_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bt record; ln record; fa record; entry_status text; bt_matched numeric; line_matched numeric;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a match is never deleted (unmatch marks it REMOVED)' USING ERRCODE = 'check_violation';
  END IF;
  -- Serialise per statement line and per ledger line, so concurrent matches can't both pass the limits below.
  SELECT * INTO bt FROM "BankTransaction" WHERE id = NEW."bankTransactionId" FOR UPDATE;
  SELECT * INTO ln FROM "JournalLine" WHERE id = NEW."journalLineId" FOR UPDATE;
  IF bt."reconciliationId" IS NOT NULL THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: statement line % is reconciled; its matches are final', bt.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."businessId", NEW."bankTransactionId", NEW."journalLineId", NEW.amount, NEW."matchedAt", NEW."matchedByAdminId", NEW."adjustmentMovementId")
         IS DISTINCT FROM (OLD."businessId", OLD."bankTransactionId", OLD."journalLineId", OLD.amount, OLD."matchedAt", OLD."matchedByAdminId", OLD."adjustmentMovementId")
       OR OLD.status = 'REMOVED'
       OR NEW.status <> 'REMOVED' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: a match only changes by being removed' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'ACTIVE' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a match starts ACTIVE' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO fa FROM "FinancialAccount" WHERE id = bt."financialAccountId";
  SELECT status INTO entry_status FROM "JournalEntry" WHERE id = ln."entryId";
  IF bt."businessId" <> NEW."businessId" OR fa."businessId" <> NEW."businessId" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: match crosses businesses' USING ERRCODE = 'check_violation';
  END IF;
  IF ln."accountId" <> fa."ledgerAccountId" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: ledger line % is not on the statement''s account', ln.id USING ERRCODE = 'check_violation';
  END IF;
  IF entry_status <> 'POSTED' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: only posted ledger lines can be matched' USING ERRCODE = 'check_violation'; END IF;
  IF (bt.amount > 0) <> (ln.debit > 0) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: money in on the statement matches a debit in the ledger (and money out a credit)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(amount), 0) INTO bt_matched FROM "BankTransactionMatch" WHERE "bankTransactionId" = bt.id AND status = 'ACTIVE';
  SELECT coalesce(sum(amount), 0) INTO line_matched FROM "BankTransactionMatch" WHERE "journalLineId" = ln.id AND status = 'ACTIVE';
  IF bt_matched + NEW.amount > abs(bt.amount) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: statement line % would be matched beyond its amount', bt.id USING ERRCODE = 'check_violation';
  END IF;
  IF line_matched + NEW.amount > ln.debit + ln.credit THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: ledger line % would be matched beyond its amount', ln.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "BankTransactionMatch_guard" BEFORE INSERT OR UPDATE OR DELETE ON "BankTransactionMatch"
  FOR EACH ROW EXECUTE FUNCTION finance_bank_match_guard();

-- The statement line's matchedAmount is the Σ of its ACTIVE matches — maintained here, never written by the service.
CREATE OR REPLACE FUNCTION finance_bank_match_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "BankTransaction" SET "matchedAmount" =
    (SELECT coalesce(sum(amount), 0) FROM "BankTransactionMatch" WHERE "bankTransactionId" = NEW."bankTransactionId" AND status = 'ACTIVE'),
    "updatedAt" = now()
  WHERE id = NEW."bankTransactionId";
  RETURN NULL;
END $$;
CREATE TRIGGER "BankTransactionMatch_sync" AFTER INSERT OR UPDATE ON "BankTransactionMatch"
  FOR EACH ROW EXECUTE FUNCTION finance_bank_match_sync();

-- T-5 imports are append-only; reconciliations are frozen once COMPLETED / ABANDONED, and completed periods never overlap
CREATE OR REPLACE FUNCTION finance_statement_import_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: statement imports are append-only' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "StatementImport_guard" BEFORE UPDATE OR DELETE ON "StatementImport"
  FOR EACH ROW EXECUTE FUNCTION finance_statement_import_guard();

CREATE OR REPLACE FUNCTION finance_bank_reconciliation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: reconciliation history is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a reconciliation starts IN_PROGRESS' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: % reconciliation % is history and never changes', OLD.status, OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."businessId", NEW."financialAccountId", NEW."periodStart", NEW."periodEnd", NEW."openingStatementBalance", NEW."closingStatementBalance")
     IS DISTINCT FROM (OLD."businessId", OLD."financialAccountId", OLD."periodStart", OLD."periodEnd", OLD."openingStatementBalance", OLD."closingStatementBalance") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a reconciliation''s account, period and statement balances are fixed (abandon it and start another)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'COMPLETED' THEN
    IF NEW."unexplainedDifference" IS DISTINCT FROM 0 OR NEW."statementGap" IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: a reconciliation completes only with no unexplained difference and a complete statement' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "BankReconciliation" r WHERE r."financialAccountId" = NEW."financialAccountId" AND r.id <> NEW.id
               AND r.status = 'COMPLETED' AND r."periodStart" <= NEW."periodEnd" AND r."periodEnd" >= NEW."periodStart") THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: completed reconciliations of an account never overlap' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "BankReconciliation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "BankReconciliation"
  FOR EACH ROW EXECUTE FUNCTION finance_bank_reconciliation_guard();

-- T-6 audit atomicity (Phase 1 F-6) for every Phase 2 record
CREATE CONSTRAINT TRIGGER "TreasuryMovement_audit" AFTER INSERT OR UPDATE OR DELETE ON "TreasuryMovement"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('TreasuryMovement');
CREATE CONSTRAINT TRIGGER "BankTransaction_audit" AFTER INSERT OR UPDATE OR DELETE ON "BankTransaction"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('BankTransaction');
CREATE CONSTRAINT TRIGGER "BankTransactionMatch_audit" AFTER INSERT OR UPDATE OR DELETE ON "BankTransactionMatch"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('BankTransactionMatch');
CREATE CONSTRAINT TRIGGER "StatementImport_audit" AFTER INSERT OR UPDATE OR DELETE ON "StatementImport"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('StatementImport');
CREATE CONSTRAINT TRIGGER "BankReconciliation_audit" AFTER INSERT OR UPDATE OR DELETE ON "BankReconciliation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('BankReconciliation');

-- T-7 no TRUNCATE (Phase 1 F-10)
CREATE TRIGGER "TreasuryMovement_no_truncate" BEFORE TRUNCATE ON "TreasuryMovement" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "BankTransaction_no_truncate" BEFORE TRUNCATE ON "BankTransaction" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "BankTransactionMatch_no_truncate" BEFORE TRUNCATE ON "BankTransactionMatch" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "StatementImport_no_truncate" BEFORE TRUNCATE ON "StatementImport" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "BankReconciliation_no_truncate" BEFORE TRUNCATE ON "BankReconciliation" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
