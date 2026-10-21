-- Owner's books §2 (docs/FINANCE_OWNER_BOOKS.md): who holds each cash account, handovers that wait for the receiver, cash counts.

-- AlterTable
ALTER TABLE "FinancialAccount" ADD COLUMN     "custodianAdminId" TEXT;

-- AlterTable
ALTER TABLE "TreasuryMovement" ADD COLUMN     "receiverAdminId" TEXT;

-- CreateTable
CREATE TABLE "CashCount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "countDate" DATE NOT NULL,
    "counted" DECIMAL(18,2) NOT NULL,
    "expected" DECIMAL(18,2) NOT NULL,
    "difference" DECIMAL(18,2) NOT NULL,
    "movementId" TEXT,
    "note" TEXT,
    "countedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashCount_movementId_key" ON "CashCount"("movementId");

-- CreateIndex
CREATE INDEX "CashCount_financialAccountId_countDate_idx" ON "CashCount"("financialAccountId", "countDate");

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_custodianAdminId_fkey" FOREIGN KEY ("custodianAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- C-1 a count is what was counted, what the books held and the difference between them
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_values" CHECK ("counted" >= 0 AND "difference" = "counted" - "expected");

-- C-2 a cash count is history: never changed or deleted (a wrong count is corrected by counting again)
CREATE OR REPLACE FUNCTION finance_cash_count_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: a cash count is immutable (count again)' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "CashCount_guard" BEFORE UPDATE OR DELETE ON "CashCount" FOR EACH ROW EXECUTE FUNCTION finance_cash_count_guard();
CREATE TRIGGER "CashCount_no_truncate" BEFORE TRUNCATE ON "CashCount" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();

-- C-3 only a cash account has a custodian
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_custodian_cash" CHECK ("custodianAdminId" IS NULL OR "kind" = 'CASH');

-- C-4 the receiver of a handover is part of the movement: immutable like the rest of it
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
    IF NEW."receiverAdminId" IS NOT NULL AND (NEW.kind <> 'TRANSFER' OR NEW.status <> 'PENDING_APPROVAL') THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: only a transfer waits for its receiver' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."businessId", NEW.kind, NEW.direction, NEW."movementDate", NEW.amount, NEW.currency, NEW."fromFinancialAccountId", NEW."toFinancialAccountId",
      NEW."counterAccountId", NEW."idempotencyKey", NEW.fingerprint, NEW."bankTransactionId", NEW."supplierId", NEW."refundOfPaymentId", NEW."refundOfCreditNoteId", NEW."receiverAdminId")
     IS DISTINCT FROM
     (OLD."businessId", OLD.kind, OLD.direction, OLD."movementDate", OLD.amount, OLD.currency, OLD."fromFinancialAccountId", OLD."toFinancialAccountId",
      OLD."counterAccountId", OLD."idempotencyKey", OLD.fingerprint, OLD."bankTransactionId", OLD."supplierId", OLD."refundOfPaymentId", OLD."refundOfCreditNoteId", OLD."receiverAdminId") THEN
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
