-- ERP E12 — budgets (docs/FINANCE_BUDGETS.md)

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startMonth" TEXT NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 12,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Budget_businessId_name_key" ON "Budget"("businessId", "name");

-- CreateIndex
CREATE INDEX "BudgetLine_accountId_idx" ON "BudgetLine"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_budgetId_accountId_periodKey_key" ON "BudgetLine"("budgetId", "accountId", "periodKey");

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- B-1 values: months as YYYY-MM, 1–60 months, amounts never negative (each line in its account's natural direction)
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_values" CHECK ("startMonth" ~ '^\d{4}-(0[1-9]|1[0-2])$' AND "months" BETWEEN 1 AND 60 AND length(btrim("name")) > 0);
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_values" CHECK ("periodKey" ~ '^\d{4}-(0[1-9]|1[0-2])$' AND "amount" >= 0);

-- B-2 audit at commit
CREATE CONSTRAINT TRIGGER "Budget_audit" AFTER INSERT OR UPDATE OR DELETE ON "Budget" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('Budget');
