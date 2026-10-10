-- ERP E10 — loans (docs/FINANCE_LOANS.md)

-- CreateEnum
CREATE TYPE "LoanRepaymentType" AS ENUM ('ANNUITY', 'EQUAL_PRINCIPAL');

-- CreateEnum
CREATE TYPE "LoanAccrualStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "lender" TEXT NOT NULL,
    "reference" TEXT,
    "principal" DECIMAL(18,2) NOT NULL,
    "annualRatePct" DECIMAL(7,4) NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "repaymentType" "LoanRepaymentType" NOT NULL DEFAULT 'ANNUITY',
    "drawdownDate" DATE NOT NULL,
    "firstDueDate" DATE NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "drawdownMovementId" TEXT NOT NULL,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanRepayment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "interestPart" DECIMAL(18,2) NOT NULL,
    "principalPart" DECIMAL(18,2) NOT NULL,
    "interestMovementId" TEXT,
    "principalMovementId" TEXT,
    "reference" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanRepayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanAccrualRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "status" "LoanAccrualStatus" NOT NULL DEFAULT 'POSTED',
    "total" DECIMAL(18,2) NOT NULL,
    "journalEntryId" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,

    CONSTRAINT "LoanAccrualRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanAccrualLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "LoanAccrualLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Loan_drawdownMovementId_key" ON "Loan"("drawdownMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_businessId_number_key" ON "Loan"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "LoanRepayment_interestMovementId_key" ON "LoanRepayment"("interestMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanRepayment_principalMovementId_key" ON "LoanRepayment"("principalMovementId");

-- CreateIndex
CREATE INDEX "LoanRepayment_loanId_idx" ON "LoanRepayment"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanAccrualRun_journalEntryId_key" ON "LoanAccrualRun"("journalEntryId");

-- CreateIndex
CREATE INDEX "LoanAccrualRun_businessId_periodKey_idx" ON "LoanAccrualRun"("businessId", "periodKey");

-- CreateIndex
CREATE INDEX "LoanAccrualLine_loanId_idx" ON "LoanAccrualLine"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanAccrualLine_runId_loanId_key" ON "LoanAccrualLine"("runId", "loanId");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_drawdownMovementId_fkey" FOREIGN KEY ("drawdownMovementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRepayment" ADD CONSTRAINT "LoanRepayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRepayment" ADD CONSTRAINT "LoanRepayment_interestMovementId_fkey" FOREIGN KEY ("interestMovementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRepayment" ADD CONSTRAINT "LoanRepayment_principalMovementId_fkey" FOREIGN KEY ("principalMovementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAccrualRun" ADD CONSTRAINT "LoanAccrualRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAccrualRun" ADD CONSTRAINT "LoanAccrualRun_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAccrualLine" ADD CONSTRAINT "LoanAccrualLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LoanAccrualRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAccrualLine" ADD CONSTRAINT "LoanAccrualLine_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- L-1 values
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_values" CHECK (
  "principal" > 0 AND "annualRatePct" >= 0 AND "annualRatePct" <= 100 AND "termMonths" BETWEEN 1 AND 600
  AND "firstDueDate" > "drawdownDate" AND length(btrim("lender")) > 0);
ALTER TABLE "LoanRepayment" ADD CONSTRAINT "LoanRepayment_values" CHECK (
  "interestPart" >= 0 AND "principalPart" >= 0 AND "interestPart" + "principalPart" > 0
  AND (("interestPart" > 0) = ("interestMovementId" IS NOT NULL)) AND (("principalPart" > 0) = ("principalMovementId" IS NOT NULL)));
ALTER TABLE "LoanAccrualRun" ADD CONSTRAINT "LoanAccrualRun_values" CHECK (
  "periodKey" ~ '^\d{4}-(0[1-9]|1[0-2])$' AND "total" >= 0 AND (("status" = 'REVERSED') = ("reversedAt" IS NOT NULL)) AND ("status" = 'POSTED' OR "reversalReason" IS NOT NULL));
ALTER TABLE "LoanAccrualLine" ADD CONSTRAINT "LoanAccrualLine_values" CHECK ("amount" > 0);
CREATE UNIQUE INDEX "LoanAccrualRun_one_per_month" ON "LoanAccrualRun"("businessId", "periodKey") WHERE "status" = 'POSTED';

-- L-2 loans and repayments are records of their money movements: immutable, never deleted (reverse the movements)
CREATE OR REPLACE FUNCTION finance_loan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  -- (each NEW field reference is nested under its table: PL/pgSQL plans it even when an AND before it is false)
  IF TG_TABLE_NAME = 'Loan' AND TG_OP = 'UPDATE' THEN
    IF (NEW."businessId", NEW.number, NEW.lender, NEW.principal, NEW."annualRatePct", NEW."termMonths", NEW."repaymentType", NEW."drawdownDate", NEW."firstDueDate", NEW."financialAccountId", NEW."drawdownMovementId")
       IS NOT DISTINCT FROM (OLD."businessId", OLD.number, OLD.lender, OLD.principal, OLD."annualRatePct", OLD."termMonths", OLD."repaymentType", OLD."drawdownDate", OLD."firstDueDate", OLD."financialAccountId", OLD."drawdownMovementId") THEN
      RETURN NEW; -- reference and notes may change
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'LoanAccrualRun' AND TG_OP = 'UPDATE' THEN
    IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED'
       AND (NEW."businessId", NEW."periodKey", NEW.total, NEW."journalEntryId") IS NOT DISTINCT FROM (OLD."businessId", OLD."periodKey", OLD.total, OLD."journalEntryId") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: % is append-only (reverse its money movement or the latest accrual run)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "Loan_guard" BEFORE UPDATE OR DELETE ON "Loan" FOR EACH ROW EXECUTE FUNCTION finance_loan_guard();
CREATE TRIGGER "LoanRepayment_guard" BEFORE UPDATE OR DELETE ON "LoanRepayment" FOR EACH ROW EXECUTE FUNCTION finance_loan_guard();
CREATE TRIGGER "LoanAccrualRun_guard" BEFORE UPDATE OR DELETE ON "LoanAccrualRun" FOR EACH ROW EXECUTE FUNCTION finance_loan_guard();
CREATE TRIGGER "LoanAccrualLine_guard" BEFORE UPDATE OR DELETE ON "LoanAccrualLine" FOR EACH ROW EXECUTE FUNCTION finance_loan_guard();

-- L-3 audit at commit, no TRUNCATE
CREATE CONSTRAINT TRIGGER "Loan_audit" AFTER INSERT OR UPDATE OR DELETE ON "Loan" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('Loan');
CREATE CONSTRAINT TRIGGER "LoanRepayment_audit" AFTER INSERT OR UPDATE OR DELETE ON "LoanRepayment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('LoanRepayment');
CREATE CONSTRAINT TRIGGER "LoanAccrualRun_audit" AFTER INSERT OR UPDATE OR DELETE ON "LoanAccrualRun" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('LoanAccrualRun');
CREATE TRIGGER "Loan_no_truncate" BEFORE TRUNCATE ON "Loan" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "LoanRepayment_no_truncate" BEFORE TRUNCATE ON "LoanRepayment" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "LoanAccrualRun_no_truncate" BEFORE TRUNCATE ON "LoanAccrualRun" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "LoanAccrualLine_no_truncate" BEFORE TRUNCATE ON "LoanAccrualLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
