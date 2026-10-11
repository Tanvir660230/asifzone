-- Financial Core Phase 4F — supplier payments and allocations (docs/FINANCE_PHASE_4F.md)

-- CreateEnum
CREATE TYPE "SupplierAllocationStatus" AS ENUM ('ACTIVE', 'RELEASED');


-- AlterTable
ALTER TABLE "TreasuryMovement" ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "SupplierAllocation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentMovementId" TEXT,
    "creditNoteId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "SupplierAllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedByAdminId" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,

    CONSTRAINT "SupplierAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierAllocation_invoiceId_status_idx" ON "SupplierAllocation"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "SupplierAllocation_paymentMovementId_idx" ON "SupplierAllocation"("paymentMovementId");

-- CreateIndex
CREATE INDEX "SupplierAllocation_creditNoteId_idx" ON "SupplierAllocation"("creditNoteId");

-- CreateIndex
CREATE INDEX "SupplierAllocation_supplierId_idx" ON "SupplierAllocation"("supplierId");

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAllocation" ADD CONSTRAINT "SupplierAllocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAllocation" ADD CONSTRAINT "SupplierAllocation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAllocation" ADD CONSTRAINT "SupplierAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAllocation" ADD CONSTRAINT "SupplierAllocation_paymentMovementId_fkey" FOREIGN KEY ("paymentMovementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAllocation" ADD CONSTRAINT "SupplierAllocation_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- F-1 a supplier payment's shape: out of a money account, against payables, naming its supplier (no other kind names one)
ALTER TABLE "TreasuryMovement" DROP CONSTRAINT "TreasuryMovement_shape";
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_shape" CHECK (
  CASE "kind"
    WHEN 'DEPOSIT' THEN "toFinancialAccountId" IS NOT NULL AND "fromFinancialAccountId" IS NULL AND "counterAccountId" IS NOT NULL AND "direction" IS NULL
    WHEN 'OPENING_FUNDING' THEN "toFinancialAccountId" IS NOT NULL AND "fromFinancialAccountId" IS NULL AND "counterAccountId" IS NOT NULL AND "direction" IS NULL
    WHEN 'WITHDRAWAL' THEN "fromFinancialAccountId" IS NOT NULL AND "toFinancialAccountId" IS NULL AND "counterAccountId" IS NOT NULL AND "direction" IS NULL
    WHEN 'TRANSFER' THEN "fromFinancialAccountId" IS NOT NULL AND "toFinancialAccountId" IS NOT NULL AND "fromFinancialAccountId" <> "toFinancialAccountId" AND "counterAccountId" IS NULL AND "direction" IS NULL
    WHEN 'ADJUSTMENT' THEN "counterAccountId" IS NOT NULL AND (
      ("direction" = 'IN' AND "toFinancialAccountId" IS NOT NULL AND "fromFinancialAccountId" IS NULL) OR
      ("direction" = 'OUT' AND "fromFinancialAccountId" IS NOT NULL AND "toFinancialAccountId" IS NULL))
    WHEN 'SUPPLIER_PAYMENT' THEN "fromFinancialAccountId" IS NOT NULL AND "toFinancialAccountId" IS NULL AND "counterAccountId" IS NOT NULL AND "direction" IS NULL
  END
  AND (("kind" = 'SUPPLIER_PAYMENT') = ("supplierId" IS NOT NULL))
);

-- the movement guard, extended: the supplier is as immutable as the rest
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
      NEW."counterAccountId", NEW."idempotencyKey", NEW.fingerprint, NEW."bankTransactionId", NEW."supplierId")
     IS DISTINCT FROM
     (OLD."businessId", OLD.kind, OLD.direction, OLD."movementDate", OLD.amount, OLD.currency, OLD."fromFinancialAccountId", OLD."toFinancialAccountId",
      OLD."counterAccountId", OLD."idempotencyKey", OLD.fingerprint, OLD."bankTransactionId", OLD."supplierId") THEN
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

-- F-2 an allocation: a positive amount from exactly one source; released with its time and reason
ALTER TABLE "SupplierAllocation" ADD CONSTRAINT "SupplierAllocation_values" CHECK (
  "amount" > 0 AND (("paymentMovementId" IS NULL) <> ("creditNoteId" IS NULL))
  AND (("status" = 'RELEASED') = ("releasedAt" IS NOT NULL)) AND ("status" = 'ACTIVE' OR "releaseReason" IS NOT NULL));

-- F-3 lifecycle: created ACTIVE against a posted bill of the same supplier, from a live payment or a posted credit note of
--     that supplier; only released afterwards (never edited or deleted)
CREATE OR REPLACE FUNCTION ap_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b record; src record;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: an allocation is released, never deleted' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'RELEASED' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a released allocation is final' USING ERRCODE = 'check_violation'; END IF;
    IF (NEW."businessId", NEW."supplierId", NEW."invoiceId", NEW."paymentMovementId", NEW."creditNoteId", NEW.amount, NEW."createdByAdminId", NEW."createdAt")
       IS DISTINCT FROM (OLD."businessId", OLD."supplierId", OLD."invoiceId", OLD."paymentMovementId", OLD."creditNoteId", OLD.amount, OLD."createdByAdminId", OLD."createdAt") THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: an allocation is immutable (release it)' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'ACTIVE' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: an allocation starts ACTIVE' USING ERRCODE = 'check_violation'; END IF;
  SELECT kind::text AS kind, status::text AS status, "supplierId" INTO b FROM "SupplierInvoice" WHERE id = NEW."invoiceId";
  IF b.kind <> 'INVOICE' OR b.status <> 'POSTED' OR b."supplierId" <> NEW."supplierId" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: allocations settle a posted bill of the same supplier' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."paymentMovementId" IS NOT NULL THEN
    SELECT kind::text AS kind, status::text AS status, "supplierId" INTO src FROM "TreasuryMovement" WHERE id = NEW."paymentMovementId";
    IF src.kind <> 'SUPPLIER_PAYMENT' OR src.status NOT IN ('PENDING_APPROVAL', 'POSTED') OR src."supplierId" <> NEW."supplierId" THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: allocations come from a live payment to the same supplier' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT kind::text AS kind, status::text AS status, "supplierId" INTO src FROM "SupplierInvoice" WHERE id = NEW."creditNoteId";
    IF src.kind <> 'CREDIT_NOTE' OR src.status <> 'POSTED' OR src."supplierId" <> NEW."supplierId" THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: allocations come from a posted credit note of the same supplier' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SupplierAllocation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SupplierAllocation" FOR EACH ROW EXECUTE FUNCTION ap_allocation_guard();

-- F-4 never over-allocated (checked at commit): a bill's active allocations ≤ its total; a payment's ≤ its amount; a credit
--     note's ≤ its total
CREATE OR REPLACE FUNCTION ap_allocation_limits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE used numeric; cap numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO used FROM "SupplierAllocation" WHERE "invoiceId" = NEW."invoiceId" AND status = 'ACTIVE';
  SELECT total INTO cap FROM "SupplierInvoice" WHERE id = NEW."invoiceId";
  IF used > cap THEN RAISE EXCEPTION 'FINANCE_INVARIANT: bill % is allocated beyond its total', NEW."invoiceId" USING ERRCODE = 'check_violation'; END IF;
  IF NEW."paymentMovementId" IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO used FROM "SupplierAllocation" WHERE "paymentMovementId" = NEW."paymentMovementId" AND status = 'ACTIVE';
    SELECT amount INTO cap FROM "TreasuryMovement" WHERE id = NEW."paymentMovementId";
  ELSE
    SELECT COALESCE(SUM(amount), 0) INTO used FROM "SupplierAllocation" WHERE "creditNoteId" = NEW."creditNoteId" AND status = 'ACTIVE';
    SELECT total INTO cap FROM "SupplierInvoice" WHERE id = NEW."creditNoteId";
  END IF;
  IF used > cap THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a payment or credit note is allocated beyond its amount' USING ERRCODE = 'check_violation'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "SupplierAllocation_limits" AFTER INSERT OR UPDATE ON "SupplierAllocation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ap_allocation_limits();

-- F-5 audit at commit, no TRUNCATE
CREATE CONSTRAINT TRIGGER "SupplierAllocation_audit" AFTER INSERT OR UPDATE OR DELETE ON "SupplierAllocation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('SupplierAllocation');
CREATE TRIGGER "SupplierAllocation_no_truncate" BEFORE TRUNCATE ON "SupplierAllocation" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
