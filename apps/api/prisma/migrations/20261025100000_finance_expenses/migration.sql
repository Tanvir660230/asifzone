-- ERP E7 — expenses and recurring commitments (docs/FINANCE_EXPENSES.md)

-- CreateEnum
CREATE TYPE "CostBehaviour" AS ENUM ('FIXED', 'VARIABLE');

-- CreateEnum
CREATE TYPE "CommitmentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateTable
CREATE TABLE "RecurringCommitment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "frequency" "CommitmentFrequency" NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "costBehaviour" "CostBehaviour" NOT NULL DEFAULT 'FIXED',
    "payee" TEXT,
    "supplierId" TEXT,
    "financialAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "expenseDate" DATE NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "costBehaviour" "CostBehaviour" NOT NULL,
    "payee" TEXT,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "evidence" TEXT,
    "movementId" TEXT NOT NULL,
    "commitmentId" TEXT,
    "periodKey" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringCommitment_businessId_isActive_idx" ON "RecurringCommitment"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_movementId_key" ON "Expense"("movementId");

-- CreateIndex
CREATE INDEX "Expense_businessId_expenseDate_idx" ON "Expense"("businessId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_commitmentId_periodKey_idx" ON "Expense"("commitmentId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_businessId_number_key" ON "Expense"("businessId", "number");

-- AddForeignKey
ALTER TABLE "RecurringCommitment" ADD CONSTRAINT "RecurringCommitment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCommitment" ADD CONSTRAINT "RecurringCommitment_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCommitment" ADD CONSTRAINT "RecurringCommitment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCommitment" ADD CONSTRAINT "RecurringCommitment_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "RecurringCommitment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- X-1 values: positive amounts; a due day every month has; an end after the start; a commitment period is YYYY-MM and
--     only on an expense that pays a commitment
ALTER TABLE "RecurringCommitment" ADD CONSTRAINT "RecurringCommitment_values" CHECK (
  "amount" > 0 AND "dayOfMonth" BETWEEN 1 AND 28 AND ("endDate" IS NULL OR "endDate" >= "startDate") AND length(btrim("name")) > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_values" CHECK (
  "amount" > 0 AND length(btrim("description")) > 0
  AND (("commitmentId" IS NULL) = ("periodKey" IS NULL)) AND ("periodKey" IS NULL OR "periodKey" ~ '^\d{4}-(0[1-9]|1[0-2])$'));

-- X-2 an expense is the record of its money movement: never changed or deleted (reverse the movement)
CREATE OR REPLACE FUNCTION finance_expense_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: an expense is immutable (reverse its payment)' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "Expense_guard" BEFORE UPDATE OR DELETE ON "Expense" FOR EACH ROW EXECUTE FUNCTION finance_expense_guard();

-- X-3 the movement is a WITHDRAWAL against the expense's own account, for the expense's amount
CREATE OR REPLACE FUNCTION finance_expense_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m record;
BEGIN
  SELECT kind::text AS kind, "counterAccountId", amount, "businessId" INTO m FROM "TreasuryMovement" WHERE id = NEW."movementId";
  IF m.kind <> 'WITHDRAWAL' OR m."counterAccountId" <> NEW."expenseAccountId" OR m.amount <> NEW.amount OR m."businessId" <> NEW."businessId" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: an expense is a withdrawal of its amount against its expense account' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Expense_movement" BEFORE INSERT ON "Expense" FOR EACH ROW EXECUTE FUNCTION finance_expense_movement();

-- X-4 audit at commit, no TRUNCATE
CREATE CONSTRAINT TRIGGER "Expense_audit" AFTER INSERT OR UPDATE OR DELETE ON "Expense"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('Expense');
CREATE CONSTRAINT TRIGGER "RecurringCommitment_audit" AFTER INSERT OR UPDATE OR DELETE ON "RecurringCommitment"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('RecurringCommitment');
CREATE TRIGGER "Expense_no_truncate" BEFORE TRUNCATE ON "Expense" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "RecurringCommitment_no_truncate" BEFORE TRUNCATE ON "RecurringCommitment" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
