-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE');

-- CreateEnum
CREATE TYPE "LedgerNormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "FinanceValuationStatus" AS ENUM ('KNOWN', 'ESTIMATED', 'MISSING', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "FinancialAccountKind" AS ENUM ('CASH', 'BANK', 'MOBILE_WALLET', 'PAYMENT_GATEWAY', 'COURIER', 'OTHER');

-- CreateEnum
CREATE TYPE "FinancialPeriodStatus" AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "JournalEntryKind" AS ENUM ('MANUAL', 'OPENING_BALANCE', 'EVENT', 'REVERSAL', 'CORRECTION');

-- CreateEnum
CREATE TYPE "FinancialEventStatus" AS ENUM ('RECEIVED', 'POSTED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "FinanceActorType" AS ENUM ('ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OpeningBalanceStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "OpeningBalanceCategory" AS ENUM ('CASH', 'BANK', 'MOBILE_WALLET', 'PAYMENT_ACCOUNT', 'INVENTORY', 'RECEIVABLE', 'PAYABLE', 'LOAN', 'FIXED_ASSET', 'CAPITAL', 'OTHER_ASSET', 'OTHER_LIABILITY', 'OTHER_EQUITY');

-- CreateEnum
CREATE TYPE "OpeningInventoryConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED', 'DIFFERENCE', 'NOT_APPLICABLE', 'ERROR');

-- CreateTable
CREATE TABLE "FinanceBusiness" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" VARCHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 7,
    "openingDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceBusiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceBrand" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "installId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "LedgerAccountType" NOT NULL,
    "normalBalance" "LedgerNormalBalance" NOT NULL,
    "parentId" TEXT,
    "isPostable" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountMapping" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT,
    "kind" "FinancialAccountKind" NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "accountNumberLast4" VARCHAR(4),
    "currency" VARCHAR(3) NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialPeriod" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "status" "FinancialPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceSequence" (
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "FinanceSequence_pkey" PRIMARY KEY ("businessId","name")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT,
    "number" INTEGER,
    "entryDate" DATE NOT NULL,
    "periodId" TEXT NOT NULL,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "kind" "JournalEntryKind" NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "currency" VARCHAR(3) NOT NULL,
    "totalDebit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "financialEventId" TEXT,
    "idempotencyKey" TEXT,
    "fingerprint" TEXT,
    "reversesEntryId" TEXT,
    "correctsEntryId" TEXT,
    "reason" TEXT,
    "createdByAdminId" TEXT,
    "postedByAdminId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "brandId" TEXT,
    "memo" TEXT,
    "partyType" TEXT,
    "partyId" TEXT,
    "valuationStatus" "FinanceValuationStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "sourceInstallId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL,
    "eventKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "financialDate" DATE NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "FinancialEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceAuditEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "actorType" "FinanceActorType" NOT NULL,
    "actorAdminId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "sourceType" TEXT,
    "sourceRef" TEXT,
    "correlationId" TEXT,
    "txId" BIGINT NOT NULL DEFAULT txid_current(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningBalanceBatch" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "openingDate" DATE NOT NULL,
    "status" "OpeningBalanceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "journalEntryId" TEXT,
    "createdByAdminId" TEXT,
    "postedByAdminId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningBalanceBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningBalanceLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "category" "OpeningBalanceCategory" NOT NULL,
    "accountId" TEXT NOT NULL,
    "financialAccountId" TEXT,
    "side" "LedgerNormalBalance" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "brandId" TEXT,
    "partyType" TEXT,
    "partyId" TEXT,
    "description" TEXT,

    CONSTRAINT "OpeningBalanceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningInventoryItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "variantId" TEXT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(18,2),
    "valuationAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "valuationStatus" "FinanceValuationStatus" NOT NULL,
    "valuationMethod" TEXT NOT NULL,
    "valuationSource" TEXT,
    "valuationDate" DATE NOT NULL,
    "confidence" "OpeningInventoryConfidence",
    "notes" TEXT,
    "brandId" TEXT,

    CONSTRAINT "OpeningInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "checkKey" TEXT NOT NULL,
    "fromDate" DATE,
    "toDate" DATE,
    "brandId" TEXT,
    "status" "ReconciliationStatus" NOT NULL,
    "expected" DECIMAL(18,2),
    "actual" DECIMAL(18,2),
    "difference" DECIMAL(18,2),
    "details" JSONB NOT NULL,
    "ranByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBusiness_key_key" ON "FinanceBusiness"("key");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBrand_businessId_key_key" ON "FinanceBrand"("businessId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBrand_businessId_installId_key" ON "FinanceBrand"("businessId", "installId");

-- CreateIndex
CREATE INDEX "LedgerAccount_businessId_type_idx" ON "LedgerAccount"("businessId", "type");

-- CreateIndex
CREATE INDEX "LedgerAccount_parentId_idx" ON "LedgerAccount"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_businessId_code_key" ON "LedgerAccount"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMapping_businessId_key_key" ON "AccountMapping"("businessId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAccount_ledgerAccountId_key" ON "FinancialAccount"("ledgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAccount_businessId_name_key" ON "FinancialAccount"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialPeriod_businessId_startDate_key" ON "FinancialPeriod"("businessId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_financialEventId_key" ON "JournalEntry"("financialEventId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversesEntryId_key" ON "JournalEntry"("reversesEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_correctsEntryId_key" ON "JournalEntry"("correctsEntryId");

-- CreateIndex
CREATE INDEX "JournalEntry_businessId_entryDate_idx" ON "JournalEntry"("businessId", "entryDate");

-- CreateIndex
CREATE INDEX "JournalEntry_businessId_status_idx" ON "JournalEntry"("businessId", "status");

-- CreateIndex
CREATE INDEX "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalEntry_periodId_idx" ON "JournalEntry"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_businessId_idempotencyKey_key" ON "JournalEntry"("businessId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_businessId_number_key" ON "JournalEntry"("businessId", "number");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE INDEX "JournalLine_brandId_idx" ON "JournalLine"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalLine_entryId_lineNo_key" ON "JournalLine"("entryId", "lineNo");

-- CreateIndex
CREATE INDEX "FinancialEvent_status_receivedAt_idx" ON "FinancialEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "FinancialEvent_sourceEntityType_sourceEntityId_idx" ON "FinancialEvent"("sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "FinancialEvent_businessId_eventType_idx" ON "FinancialEvent"("businessId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEvent_sourceInstallId_eventKey_key" ON "FinancialEvent"("sourceInstallId", "eventKey");

-- CreateIndex
CREATE INDEX "FinanceAuditEntry_entityType_entityId_idx" ON "FinanceAuditEntry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "FinanceAuditEntry_businessId_createdAt_idx" ON "FinanceAuditEntry"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceAuditEntry_txId_idx" ON "FinanceAuditEntry"("txId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalanceBatch_businessId_key" ON "OpeningBalanceBatch"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalanceBatch_journalEntryId_key" ON "OpeningBalanceBatch"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalanceLine_batchId_lineNo_key" ON "OpeningBalanceLine"("batchId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningInventoryItem_batchId_sku_key" ON "OpeningInventoryItem"("batchId", "sku");

-- CreateIndex
CREATE INDEX "ReconciliationRun_businessId_checkKey_createdAt_idx" ON "ReconciliationRun"("businessId", "checkKey", "createdAt");

-- AddForeignKey
ALTER TABLE "FinanceBrand" ADD CONSTRAINT "FinanceBrand_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMapping" ADD CONSTRAINT "AccountMapping_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMapping" ADD CONSTRAINT "AccountMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialPeriod" ADD CONSTRAINT "FinancialPeriod_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FinancialPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_financialEventId_fkey" FOREIGN KEY ("financialEventId") REFERENCES "FinancialEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_correctsEntryId_fkey" FOREIGN KEY ("correctsEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEvent" ADD CONSTRAINT "FinancialEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalanceBatch" ADD CONSTRAINT "OpeningBalanceBatch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalanceBatch" ADD CONSTRAINT "OpeningBalanceBatch_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalanceLine" ADD CONSTRAINT "OpeningBalanceLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OpeningBalanceBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalanceLine" ADD CONSTRAINT "OpeningBalanceLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalanceLine" ADD CONSTRAINT "OpeningBalanceLine_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningInventoryItem" ADD CONSTRAINT "OpeningInventoryItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OpeningBalanceBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Financial Core invariants, enforced by the database (docs/FINANCE_PHASE_1.md §4). The application checks the same rules
-- first (for precise errors); these make it impossible for ANY writer — a bug, a script, a future module — to commit:
--   F-1  a journal line with both / neither / a negative side                         (CHECK)
--   F-2  a POSTED journal that is unbalanced, has < 2 lines or a zero total           (transition trigger + deferred re-check)
--   F-3  any change to a POSTED journal or its lines, or its deletion                 (immutability triggers)
--   F-4  a line on a group, inactive or foreign-business account                      (line trigger)
--   F-5  posting into a CLOSED period, outside the entry's period, before the opening date (transition trigger)
--   F-6  a finance record changed without a FinanceAuditEntry in the same transaction (deferred audit triggers)
--   F-7  an edit or deletion of an audit entry                                        (append-only trigger)
--   F-8  a type / normal-balance change of an account that carries posted lines       (account trigger)
--   F-9  a change to a POSTED opening-balance batch or its lines/items                (immutability triggers)
-- The only exception is an explicit maintenance purge (SET LOCAL finance.maintenance_purge = 'on'), which disposable test
-- databases use to clean up; application code never sets it (architecture guard test).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION finance_purge_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('finance.maintenance_purge', true), '') = 'on'
$$;

-- F-1
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_one_positive_side"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0) <> ("credit" > 0)));
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_totals_non_negative" CHECK ("totalDebit" >= 0 AND "totalCredit" >= 0);
ALTER TABLE "FinanceBusiness" ADD CONSTRAINT "FinanceBusiness_fiscal_month" CHECK ("fiscalYearStartMonth" BETWEEN 1 AND 12);
ALTER TABLE "OpeningBalanceLine" ADD CONSTRAINT "OpeningBalanceLine_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "OpeningInventoryItem" ADD CONSTRAINT "OpeningInventoryItem_values" CHECK (
  "quantity" >= 0 AND "valuationAmount" >= 0 AND ("unitCost" IS NULL OR "unitCost" >= 0)
  AND ("valuationStatus" <> 'MISSING' OR ("valuationAmount" = 0 AND "unitCost" IS NULL))
);
ALTER TABLE "FinancialPeriod" ADD CONSTRAINT "FinancialPeriod_dates" CHECK ("startDate" <= "endDate");

-- Shared check of a journal that is (becoming) POSTED. Raises on any violation of F-2 / F-4 / F-5.
CREATE OR REPLACE FUNCTION finance_assert_postable(p_entry_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  e record; p record; b record;
  n_lines int; s_debit numeric; s_credit numeric; bad_lines int;
BEGIN
  SELECT * INTO e FROM "JournalEntry" WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*), coalesce(sum("debit"), 0), coalesce(sum("credit"), 0) INTO n_lines, s_debit, s_credit
    FROM "JournalLine" WHERE "entryId" = p_entry_id;
  IF n_lines < 2 THEN RAISE EXCEPTION 'FINANCE_INVARIANT: journal % has % line(s); at least 2 required', p_entry_id, n_lines USING ERRCODE = 'check_violation'; END IF;
  IF s_debit <> s_credit THEN RAISE EXCEPTION 'FINANCE_INVARIANT: journal % is unbalanced (debit %, credit %)', p_entry_id, s_debit, s_credit USING ERRCODE = 'check_violation'; END IF;
  IF s_debit = 0 THEN RAISE EXCEPTION 'FINANCE_INVARIANT: journal % moves no amount', p_entry_id USING ERRCODE = 'check_violation'; END IF;
  IF s_debit <> e."totalDebit" OR s_credit <> e."totalCredit" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: journal % totals (%/%) differ from its lines (%/%)', p_entry_id, e."totalDebit", e."totalCredit", s_debit, s_credit USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO bad_lines FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id = l."accountId"
    WHERE l."entryId" = p_entry_id AND (NOT a."isPostable" OR NOT a."isActive" OR a."businessId" <> e."businessId");
  IF bad_lines > 0 THEN RAISE EXCEPTION 'FINANCE_INVARIANT: journal % posts to a group, inactive or foreign account', p_entry_id USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO p FROM "FinancialPeriod" WHERE id = e."periodId";
  IF p."businessId" <> e."businessId" OR e."entryDate" < p."startDate" OR e."entryDate" > p."endDate" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: journal % date % is outside its period', p_entry_id, e."entryDate" USING ERRCODE = 'check_violation';
  END IF;
  IF p.status = 'CLOSED' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: period % is closed', p."startDate" USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO b FROM "FinanceBusiness" WHERE id = e."businessId";
  IF b."openingDate" IS NULL THEN RAISE EXCEPTION 'FINANCE_INVARIANT: the financial opening date is not set' USING ERRCODE = 'check_violation'; END IF;
  IF e."entryDate" < b."openingDate" THEN RAISE EXCEPTION 'FINANCE_INVARIANT: journal % is dated before the opening date %', p_entry_id, b."openingDate" USING ERRCODE = 'check_violation'; END IF;
  IF e.kind = 'OPENING_BALANCE' AND e."entryDate" <> b."openingDate" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: opening balances must be dated on the opening date' USING ERRCODE = 'check_violation';
  END IF;
  IF e.number IS NULL OR e."postedAt" IS NULL THEN RAISE EXCEPTION 'FINANCE_INVARIANT: posted journal % lacks number/postedAt', p_entry_id USING ERRCODE = 'check_violation'; END IF;
END $$;

-- F-2 / F-3 on JournalEntry
CREATE OR REPLACE FUNCTION finance_journal_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'POSTED' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: a journal is created as DRAFT and posted by a status change' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: posted journal % is immutable (reverse it instead)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'POSTED' THEN PERFORM finance_assert_postable(NEW.id); END IF;
    RETURN NEW;
  ELSE
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: posted journal % cannot be deleted', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
END $$;
CREATE TRIGGER "JournalEntry_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION finance_journal_entry_guard();

-- F-2 again at commit (defence in depth: nothing after the transition can unbalance it within the transaction either).
CREATE OR REPLACE FUNCTION finance_journal_entry_commit_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN NULL; END IF;
  IF NEW.status = 'POSTED' THEN PERFORM finance_assert_postable(NEW.id); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "JournalEntry_commit_check" AFTER INSERT OR UPDATE ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_journal_entry_commit_check();

-- F-3 / F-4 on JournalLine
CREATE OR REPLACE FUNCTION finance_journal_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text; parent_business text; acc record;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO parent_status FROM "JournalEntry" WHERE id = OLD."entryId";
    IF parent_status = 'POSTED' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: lines of posted journal % are immutable', OLD."entryId" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status, "businessId" INTO parent_status, parent_business FROM "JournalEntry" WHERE id = NEW."entryId";
    IF parent_status = 'POSTED' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: lines can''t be added to posted journal %', NEW."entryId" USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO acc FROM "LedgerAccount" WHERE id = NEW."accountId";
    IF NOT acc."isPostable" OR NOT acc."isActive" OR acc."businessId" <> parent_business THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: account % (%) can''t take postings', acc.code, acc.name USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "JournalLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION finance_journal_line_guard();

-- F-8 on LedgerAccount
CREATE OR REPLACE FUNCTION finance_ledger_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN NEW; END IF;
  IF (NEW.type <> OLD.type OR NEW."normalBalance" <> OLD."normalBalance" OR NEW."businessId" <> OLD."businessId" OR (OLD."isPostable" AND NOT NEW."isPostable"))
     AND EXISTS (SELECT 1 FROM "JournalLine" WHERE "accountId" = OLD.id) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: account % has journal lines; its type, normal balance and postability are fixed', OLD.code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LedgerAccount_guard" BEFORE UPDATE ON "LedgerAccount"
  FOR EACH ROW EXECUTE FUNCTION finance_ledger_account_guard();

-- F-7 append-only audit
CREATE OR REPLACE FUNCTION finance_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: the financial audit trail is append-only' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "FinanceAuditEntry_append_only" BEFORE UPDATE OR DELETE ON "FinanceAuditEntry"
  FOR EACH ROW EXECUTE FUNCTION finance_audit_append_only();

-- F-6 audit atomicity: at commit, every inserted/updated/deleted finance record must have an audit entry written in the
-- SAME transaction (txid) naming it. TG_ARGV[0] = the entityType the audit entry uses.
CREATE OR REPLACE FUNCTION finance_require_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid text;
BEGIN
  IF finance_purge_allowed() THEN RETURN NULL; END IF;
  rid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  IF NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" WHERE "entityType" = TG_ARGV[0] AND "entityId" = rid AND "txId" = txid_current()) THEN
    RAISE EXCEPTION 'FINANCE_AUDIT_REQUIRED: % % was changed without a financial audit entry in the same transaction', TG_ARGV[0], rid USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceBusiness_audit" AFTER INSERT OR UPDATE OR DELETE ON "FinanceBusiness"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('FinanceBusiness');
CREATE CONSTRAINT TRIGGER "FinanceBrand_audit" AFTER INSERT OR UPDATE OR DELETE ON "FinanceBrand"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('FinanceBrand');
CREATE CONSTRAINT TRIGGER "LedgerAccount_audit" AFTER INSERT OR UPDATE OR DELETE ON "LedgerAccount"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('LedgerAccount');
CREATE CONSTRAINT TRIGGER "AccountMapping_audit" AFTER INSERT OR UPDATE OR DELETE ON "AccountMapping"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('AccountMapping');
CREATE CONSTRAINT TRIGGER "FinancialAccount_audit" AFTER INSERT OR UPDATE OR DELETE ON "FinancialAccount"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('FinancialAccount');
CREATE CONSTRAINT TRIGGER "FinancialPeriod_audit" AFTER UPDATE OR DELETE ON "FinancialPeriod"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('FinancialPeriod');
CREATE CONSTRAINT TRIGGER "JournalEntry_audit" AFTER INSERT OR UPDATE OR DELETE ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('JournalEntry');
CREATE CONSTRAINT TRIGGER "OpeningBalanceBatch_audit" AFTER INSERT OR UPDATE OR DELETE ON "OpeningBalanceBatch"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('OpeningBalanceBatch');

-- F-9 opening balances are frozen once posted
CREATE OR REPLACE FUNCTION finance_opening_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: posted opening balances are immutable (adjust with a journal)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "OpeningBalanceBatch_guard" BEFORE UPDATE OR DELETE ON "OpeningBalanceBatch"
  FOR EACH ROW EXECUTE FUNCTION finance_opening_batch_guard();

CREATE OR REPLACE FUNCTION finance_opening_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO s FROM "OpeningBalanceBatch" WHERE id = COALESCE(NEW."batchId", OLD."batchId");
  IF s = 'POSTED' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: posted opening balances are immutable (adjust with a journal)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "OpeningBalanceLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "OpeningBalanceLine"
  FOR EACH ROW EXECUTE FUNCTION finance_opening_child_guard();
CREATE TRIGGER "OpeningInventoryItem_guard" BEFORE INSERT OR UPDATE OR DELETE ON "OpeningInventoryItem"
  FOR EACH ROW EXECUTE FUNCTION finance_opening_child_guard();

-- A POSTED financial event is final (its journal exists); it can't be reset to post twice.
CREATE OR REPLACE FUNCTION finance_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: posted financial event % is final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."sourceInstallId" <> OLD."sourceInstallId" OR NEW."eventKey" <> OLD."eventKey" OR NEW.payload::text <> OLD.payload::text) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a financial event''s identity and payload never change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "FinancialEvent_guard" BEFORE UPDATE OR DELETE ON "FinancialEvent"
  FOR EACH ROW EXECUTE FUNCTION finance_event_guard();
