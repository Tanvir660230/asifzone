-- Finance Center (docs/FINANCE_CENTER.md): verification status beside records, expense allocation, ad budget history,
-- subscription reminders, SMS balance readings, a default USD rate.

CREATE TYPE "EntryVerification" AS ENUM ('CONFIRMED', 'ESTIMATED', 'NEEDS_CHECK', 'DISPUTED');

ALTER TABLE "FinanceBusiness" ADD COLUMN "defaultUsdRate" DECIMAL(18,6), ADD COLUMN "smsWarnAt" DECIMAL(18,2);
ALTER TABLE "FinanceBusiness" ADD CONSTRAINT "FinanceBusiness_fc_values" CHECK (("defaultUsdRate" IS NULL OR "defaultUsdRate" > 0) AND ("smsWarnAt" IS NULL OR "smsWarnAt" >= 0));

ALTER TABLE "PrepaidCost" ADD COLUMN "remindDaysBefore" INTEGER NOT NULL DEFAULT 30, ADD COLUMN "renewalAmount" DECIMAL(18,2);
ALTER TABLE "PrepaidCost" ADD CONSTRAINT "PrepaidCost_renewal_values" CHECK ("remindDaysBefore" BETWEEN 0 AND 365 AND ("renewalAmount" IS NULL OR "renewalAmount" > 0));

CREATE TABLE "FinanceVerification" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "EntryVerification" NOT NULL,
    "source" TEXT,
    "note" TEXT,
    "setByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinanceVerification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FinanceVerification_businessId_entityType_entityId_key" ON "FinanceVerification"("businessId", "entityType", "entityId");
CREATE INDEX "FinanceVerification_businessId_status_idx" ON "FinanceVerification"("businessId", "status");
ALTER TABLE "FinanceVerification" ADD CONSTRAINT "FinanceVerification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ExpenseAllocation" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExpenseAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExpenseAllocation_amount" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "ExpenseAllocation_expenseId_lineNo_key" ON "ExpenseAllocation"("expenseId", "lineNo");
ALTER TABLE "ExpenseAllocation" ADD CONSTRAINT "ExpenseAllocation_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseAllocation" ADD CONSTRAINT "ExpenseAllocation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The parts of an expense never add up to more than the expense (checked at commit, after a set of parts is replaced).
CREATE OR REPLACE FUNCTION finance_expense_allocation_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid text := COALESCE(NEW."expenseId", OLD."expenseId"); total numeric; amt numeric;
BEGIN
  SELECT COALESCE(sum(amount), 0) INTO total FROM "ExpenseAllocation" WHERE "expenseId" = eid;
  SELECT amount INTO amt FROM "Expense" WHERE id = eid;
  IF total > amt THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: an expense''s allocations (%) exceed the expense (%)', total, amt USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ExpenseAllocation_total" AFTER INSERT OR UPDATE OR DELETE ON "ExpenseAllocation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_expense_allocation_total();
CREATE TRIGGER "ExpenseAllocation_no_truncate" BEFORE TRUNCATE ON "ExpenseAllocation" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "FinanceVerification_no_truncate" BEFORE TRUNCATE ON "FinanceVerification" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();

CREATE TABLE "AdBudgetChange" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "budgetType" "AdBudgetType",
    "budget" DECIMAL(18,2),
    "changedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdBudgetChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdBudgetChange_campaignId_effectiveDate_idx" ON "AdBudgetChange"("campaignId", "effectiveDate");
ALTER TABLE "AdBudgetChange" ADD CONSTRAINT "AdBudgetChange_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Every existing campaign's current budget, in force from its start.
INSERT INTO "AdBudgetChange" ("id", "campaignId", "effectiveDate", "budgetType", "budget", "createdAt")
  SELECT 'abc_' || "id", "id", "startDate", "budgetType", "budget", CURRENT_TIMESTAMP FROM "AdCampaign";

CREATE TABLE "SmsBalanceSnapshot" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SmsBalanceSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SmsBalanceSnapshot_source" CHECK ("source" IN ('PROVIDER', 'MANUAL'))
);
CREATE INDEX "SmsBalanceSnapshot_businessId_takenAt_idx" ON "SmsBalanceSnapshot"("businessId", "takenAt");
ALTER TABLE "SmsBalanceSnapshot" ADD CONSTRAINT "SmsBalanceSnapshot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A day's spend can come from an imported CSV too.
ALTER TABLE "AdSpendDay" DROP CONSTRAINT "AdSpendDay_values";
ALTER TABLE "AdSpendDay" ADD CONSTRAINT "AdSpendDay_values" CHECK ("amount" >= 0 AND "source" IN ('META_API', 'MANUAL', 'CSV'));
