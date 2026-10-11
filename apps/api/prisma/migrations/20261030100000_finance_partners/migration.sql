-- ERP E11 foundation — partner register (docs/FINANCE_EQUITY.md); profit distribution and capital rules wait for B-2

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "joinedOn" DATE NOT NULL,
    "leftOn" DATE,
    "agreedSharePct" DECIMAL(7,4),
    "agreementReference" TEXT,
    "capitalAccountId" TEXT NOT NULL,
    "currentAccountId" TEXT NOT NULL,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_capitalAccountId_key" ON "Partner"("capitalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_currentAccountId_key" ON "Partner"("currentAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_businessId_number_key" ON "Partner"("businessId", "number");

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_capitalAccountId_fkey" FOREIGN KEY ("capitalAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_currentAccountId_fkey" FOREIGN KEY ("currentAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Q-1 values
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_values" CHECK (
  length(btrim("name")) > 0 AND ("leftOn" IS NULL OR "leftOn" >= "joinedOn")
  AND ("agreedSharePct" IS NULL OR ("agreedSharePct" >= 0 AND "agreedSharePct" <= 100))
  AND "capitalAccountId" <> "currentAccountId");

-- Q-2 a partner is never deleted (their accounts carry history) and keeps their accounts; audit at commit
CREATE OR REPLACE FUNCTION finance_partner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."businessId", NEW.number, NEW."capitalAccountId", NEW."currentAccountId") IS NOT DISTINCT FROM (OLD."businessId", OLD.number, OLD."capitalAccountId", OLD."currentAccountId") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: a partner is never deleted and keeps their accounts' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "Partner_guard" BEFORE UPDATE OR DELETE ON "Partner" FOR EACH ROW EXECUTE FUNCTION finance_partner_guard();
CREATE CONSTRAINT TRIGGER "Partner_audit" AFTER INSERT OR UPDATE OR DELETE ON "Partner" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('Partner');
CREATE TRIGGER "Partner_no_truncate" BEFORE TRUNCATE ON "Partner" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
