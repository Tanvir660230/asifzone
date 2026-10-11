-- ERP E8 — payroll: a configurable structure (docs/FINANCE_PAYROLL.md); no statutory rule is built in (B-3)

-- CreateEnum
CREATE TYPE "PayComponentKind" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "PayCalculation" AS ENUM ('FIXED', 'PERCENT_OF_BASIC');

-- CreateEnum
CREATE TYPE "PayRunStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "department" TEXT,
    "phone" TEXT,
    "payoutDetails" TEXT,
    "joinDate" DATE NOT NULL,
    "leaveDate" DATE,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayComponent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PayComponentKind" NOT NULL,
    "calculation" "PayCalculation" NOT NULL DEFAULT 'FIXED',
    "isBasic" BOOLEAN NOT NULL DEFAULT false,
    "ratePct" DECIMAL(7,4),
    "expenseAccountId" TEXT,
    "liabilityAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePayItem" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "amount" DECIMAL(18,2),
    "ratePct" DECIMAL(7,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePayItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "periodKey" TEXT NOT NULL,
    "payDate" DATE NOT NULL,
    "status" "PayRunStatus" NOT NULL DEFAULT 'DRAFT',
    "gross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "postedByAdminId" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "daysPayable" INTEGER NOT NULL,
    "daysInPeriod" INTEGER NOT NULL,
    "gross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerCost" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipLine" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "kind" "PayComponentKind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PayslipLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipPayment" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayslipPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRemittance" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "liabilityAccountId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "periodKey" TEXT,
    "reference" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRemittance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_businessId_number_key" ON "Employee"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PayComponent_businessId_name_key" ON "PayComponent"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayItem_employeeId_componentId_key" ON "EmployeePayItem"("employeeId", "componentId");

-- CreateIndex
CREATE UNIQUE INDEX "PayRun_journalEntryId_key" ON "PayRun"("journalEntryId");

-- CreateIndex
CREATE INDEX "PayRun_businessId_periodKey_idx" ON "PayRun"("businessId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "PayRun_businessId_number_key" ON "PayRun"("businessId", "number");

-- CreateIndex
CREATE INDEX "Payslip_employeeId_idx" ON "Payslip"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_runId_employeeId_key" ON "Payslip"("runId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayslipLine_payslipId_componentId_key" ON "PayslipLine"("payslipId", "componentId");

-- CreateIndex
CREATE INDEX "PayslipPayment_movementId_idx" ON "PayslipPayment"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "PayslipPayment_payslipId_movementId_key" ON "PayslipPayment"("payslipId", "movementId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRemittance_movementId_key" ON "PayrollRemittance"("movementId");

-- CreateIndex
CREATE INDEX "PayrollRemittance_businessId_liabilityAccountId_idx" ON "PayrollRemittance"("businessId", "liabilityAccountId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayComponent" ADD CONSTRAINT "PayComponent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayComponent" ADD CONSTRAINT "PayComponent_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayComponent" ADD CONSTRAINT "PayComponent_liabilityAccountId_fkey" FOREIGN KEY ("liabilityAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayItem" ADD CONSTRAINT "EmployeePayItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayItem" ADD CONSTRAINT "EmployeePayItem_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "PayComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "PayComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipPayment" ADD CONSTRAINT "PayslipPayment_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipPayment" ADD CONSTRAINT "PayslipPayment_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRemittance" ADD CONSTRAINT "PayrollRemittance_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRemittance" ADD CONSTRAINT "PayrollRemittance_liabilityAccountId_fkey" FOREIGN KEY ("liabilityAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRemittance" ADD CONSTRAINT "PayrollRemittance_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- P-1 values
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_values" CHECK (length(btrim("name")) > 0 AND ("leaveDate" IS NULL OR "leaveDate" >= "joinDate"));
ALTER TABLE "PayComponent" ADD CONSTRAINT "PayComponent_values" CHECK (
  length(btrim("name")) > 0
  AND (("kind" = 'EARNING' AND "expenseAccountId" IS NOT NULL AND "liabilityAccountId" IS NULL)
    OR ("kind" = 'DEDUCTION' AND "liabilityAccountId" IS NOT NULL AND "expenseAccountId" IS NULL)
    OR ("kind" = 'EMPLOYER_CONTRIBUTION' AND "expenseAccountId" IS NOT NULL AND "liabilityAccountId" IS NOT NULL))
  AND (("calculation" = 'FIXED') = ("ratePct" IS NULL))
  AND ("ratePct" IS NULL OR ("ratePct" >= 0 AND "ratePct" <= 100))
  AND (NOT "isBasic" OR ("kind" = 'EARNING' AND "calculation" = 'FIXED')));
CREATE UNIQUE INDEX "PayComponent_one_basic" ON "PayComponent"("businessId") WHERE "isBasic";
ALTER TABLE "EmployeePayItem" ADD CONSTRAINT "EmployeePayItem_values" CHECK (
  ("amount" IS NULL OR "amount" >= 0) AND ("ratePct" IS NULL OR ("ratePct" >= 0 AND "ratePct" <= 100)) AND NOT ("amount" IS NOT NULL AND "ratePct" IS NOT NULL));
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_values" CHECK (
  "periodKey" ~ '^\d{4}-(0[1-9]|1[0-2])$'
  AND "gross" >= 0 AND "deductions" >= 0 AND "employerCost" >= 0 AND "net" >= 0 AND "net" = "gross" - "deductions"
  AND ("status" = 'DRAFT' OR ("journalEntryId" IS NOT NULL AND "postedAt" IS NOT NULL))
  AND (("status" = 'REVERSED') = ("reversedAt" IS NOT NULL)) AND ("status" <> 'REVERSED' OR "reversalReason" IS NOT NULL));
CREATE UNIQUE INDEX "PayRun_one_per_month" ON "PayRun"("businessId", "periodKey") WHERE "status" <> 'REVERSED';
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_values" CHECK (
  "daysInPeriod" BETWEEN 28 AND 31 AND "daysPayable" BETWEEN 0 AND "daysInPeriod"
  AND "gross" >= 0 AND "deductions" >= 0 AND "employerCost" >= 0 AND "net" >= 0 AND "net" = "gross" - "deductions");
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_values" CHECK ("amount" >= 0);
ALTER TABLE "PayslipPayment" ADD CONSTRAINT "PayslipPayment_values" CHECK ("amount" > 0);
ALTER TABLE "PayrollRemittance" ADD CONSTRAINT "PayrollRemittance_values" CHECK ("amount" > 0 AND ("periodKey" IS NULL OR "periodKey" ~ '^\d{4}-(0[1-9]|1[0-2])$'));

-- P-2 a run, its payslips and lines change only while the run is a draft; a posted run only becomes REVERSED;
--     payments and remittances are records of their money movements (reverse the movement instead)
CREATE OR REPLACE FUNCTION finance_payroll_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_status text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  -- (each NEW field reference is nested under its table: PL/pgSQL plans it even when an AND before it is false)
  IF TG_TABLE_NAME = 'PayRun' THEN
    IF OLD.status = 'DRAFT' THEN RETURN COALESCE(NEW, OLD); END IF;
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED'
         AND (NEW."businessId", NEW.number, NEW."periodKey", NEW."payDate", NEW.gross, NEW.deductions, NEW.net, NEW."employerCost", NEW."journalEntryId", NEW."postedAt")
             IS NOT DISTINCT FROM (OLD."businessId", OLD.number, OLD."periodKey", OLD."payDate", OLD.gross, OLD.deductions, OLD.net, OLD."employerCost", OLD."journalEntryId", OLD."postedAt") THEN
        RETURN NEW;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'Payslip' THEN
    SELECT r.status::text INTO run_status FROM "PayRun" r WHERE r.id = COALESCE(NEW."runId", OLD."runId");
    IF TG_OP = 'UPDATE' THEN
      IF NEW."runId" IS DISTINCT FROM OLD."runId" THEN run_status := 'MOVED'; END IF;
    END IF;
    IF run_status IS NULL OR run_status = 'DRAFT' THEN RETURN COALESCE(NEW, OLD); END IF; -- NULL: cascading from a deleted draft run
  ELSIF TG_TABLE_NAME = 'PayslipLine' THEN
    SELECT r.status::text INTO run_status FROM "Payslip" p JOIN "PayRun" r ON r.id = p."runId" WHERE p.id = COALESCE(NEW."payslipId", OLD."payslipId");
    IF TG_OP = 'UPDATE' THEN
      IF NEW."payslipId" IS DISTINCT FROM OLD."payslipId" THEN run_status := 'MOVED'; END IF;
    END IF;
    IF run_status IS NULL OR run_status = 'DRAFT' THEN RETURN COALESCE(NEW, OLD); END IF;
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: % of a posted pay run is immutable (reverse the run, or the money movement)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "PayRun_guard" BEFORE UPDATE OR DELETE ON "PayRun" FOR EACH ROW EXECUTE FUNCTION finance_payroll_guard();
CREATE TRIGGER "Payslip_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Payslip" FOR EACH ROW EXECUTE FUNCTION finance_payroll_guard();
CREATE TRIGGER "PayslipLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PayslipLine" FOR EACH ROW EXECUTE FUNCTION finance_payroll_guard();
CREATE TRIGGER "PayslipPayment_guard" BEFORE UPDATE OR DELETE ON "PayslipPayment" FOR EACH ROW EXECUTE FUNCTION finance_payroll_guard();
CREATE TRIGGER "PayrollRemittance_guard" BEFORE UPDATE OR DELETE ON "PayrollRemittance" FOR EACH ROW EXECUTE FUNCTION finance_payroll_guard();

-- P-3 audit at commit, no TRUNCATE
CREATE CONSTRAINT TRIGGER "Employee_audit" AFTER INSERT OR UPDATE OR DELETE ON "Employee" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('Employee');
CREATE CONSTRAINT TRIGGER "PayComponent_audit" AFTER INSERT OR UPDATE OR DELETE ON "PayComponent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('PayComponent');
CREATE CONSTRAINT TRIGGER "PayRun_audit" AFTER INSERT OR UPDATE OR DELETE ON "PayRun" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('PayRun');
CREATE CONSTRAINT TRIGGER "PayslipPayment_audit" AFTER INSERT OR UPDATE OR DELETE ON "PayslipPayment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('PayslipPayment');
CREATE CONSTRAINT TRIGGER "PayrollRemittance_audit" AFTER INSERT OR UPDATE OR DELETE ON "PayrollRemittance" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('PayrollRemittance');
CREATE TRIGGER "PayRun_no_truncate" BEFORE TRUNCATE ON "PayRun" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "Payslip_no_truncate" BEFORE TRUNCATE ON "Payslip" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "PayslipLine_no_truncate" BEFORE TRUNCATE ON "PayslipLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "PayslipPayment_no_truncate" BEFORE TRUNCATE ON "PayslipPayment" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "PayrollRemittance_no_truncate" BEFORE TRUNCATE ON "PayrollRemittance" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
