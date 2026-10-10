-- Supplier refunds (docs/FINANCE_PHASE_4F.md): money a supplier pays back from an advance or a credit note


-- AlterTable
ALTER TABLE "TreasuryMovement" ADD COLUMN     "refundOfCreditNoteId" TEXT,
ADD COLUMN     "refundOfPaymentId" TEXT;

-- CreateIndex
CREATE INDEX "TreasuryMovement_refundOfPaymentId_idx" ON "TreasuryMovement"("refundOfPaymentId");

-- CreateIndex
CREATE INDEX "TreasuryMovement_refundOfCreditNoteId_idx" ON "TreasuryMovement"("refundOfCreditNoteId");

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_refundOfPaymentId_fkey" FOREIGN KEY ("refundOfPaymentId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_refundOfCreditNoteId_fkey" FOREIGN KEY ("refundOfCreditNoteId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- R-1 shape: a refund comes INTO a money account against payables, names its supplier and exactly one source
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
    WHEN 'SUPPLIER_REFUND' THEN "toFinancialAccountId" IS NOT NULL AND "fromFinancialAccountId" IS NULL AND "counterAccountId" IS NOT NULL AND "direction" IS NULL
  END
  AND (("kind" IN ('SUPPLIER_PAYMENT', 'SUPPLIER_REFUND')) = ("supplierId" IS NOT NULL))
  AND (CASE WHEN "kind" = 'SUPPLIER_REFUND' THEN num_nonnulls("refundOfPaymentId", "refundOfCreditNoteId") = 1
            ELSE "refundOfPaymentId" IS NULL AND "refundOfCreditNoteId" IS NULL END)
);

-- the movement guard, extended: a refund's source is as immutable as the rest
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
      NEW."counterAccountId", NEW."idempotencyKey", NEW.fingerprint, NEW."bankTransactionId", NEW."supplierId", NEW."refundOfPaymentId", NEW."refundOfCreditNoteId")
     IS DISTINCT FROM
     (OLD."businessId", OLD.kind, OLD.direction, OLD."movementDate", OLD.amount, OLD.currency, OLD."fromFinancialAccountId", OLD."toFinancialAccountId",
      OLD."counterAccountId", OLD."idempotencyKey", OLD.fingerprint, OLD."bankTransactionId", OLD."supplierId", OLD."refundOfPaymentId", OLD."refundOfCreditNoteId") THEN
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


-- R-2 a refund's source is a live payment or a posted credit note of the SAME supplier
CREATE OR REPLACE FUNCTION finance_supplier_refund_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src record;
BEGIN
  IF NEW.kind <> 'SUPPLIER_REFUND' THEN RETURN NEW; END IF;
  IF NEW."refundOfPaymentId" IS NOT NULL THEN
    SELECT kind::text AS kind, status::text AS status, "supplierId" INTO src FROM "TreasuryMovement" WHERE id = NEW."refundOfPaymentId";
    IF src.kind <> 'SUPPLIER_PAYMENT' OR src.status NOT IN ('PENDING_APPROVAL', 'POSTED') OR src."supplierId" <> NEW."supplierId" THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: a refund names a live payment of the same supplier' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT kind::text AS kind, status::text AS status, "supplierId" INTO src FROM "SupplierInvoice" WHERE id = NEW."refundOfCreditNoteId";
    IF src.kind <> 'CREDIT_NOTE' OR src.status <> 'POSTED' OR src."supplierId" <> NEW."supplierId" THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: a refund names a posted credit note of the same supplier' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TreasuryMovement_refund_source" BEFORE INSERT ON "TreasuryMovement" FOR EACH ROW EXECUTE FUNCTION finance_supplier_refund_source();
