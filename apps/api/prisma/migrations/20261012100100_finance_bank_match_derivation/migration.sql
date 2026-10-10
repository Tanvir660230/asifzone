-- Financial Core Phase 2 (docs/FINANCE_PHASE_2.md §8, T-3): a statement line's matchedAmount was maintained by the match
-- trigger but could still be written directly. The guard now recomputes it from the ACTIVE matches on every update, so
-- it can't drift from them (and its status, derived from it, can't either).

CREATE OR REPLACE FUNCTION finance_bank_transaction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.source <> 'MANUAL' OR OLD."matchedAmount" <> 0 OR OLD."reconciliationId" IS NOT NULL
       OR EXISTS (SELECT 1 FROM "BankTransactionMatch" WHERE "bankTransactionId" = OLD.id)
       OR EXISTS (SELECT 1 FROM "TreasuryMovement" WHERE "bankTransactionId" = OLD.id) THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: statement line % has history and cannot be deleted', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."businessId", NEW."financialAccountId", NEW."transactionDate", NEW."valueDate", NEW.reference, NEW.description, NEW.debit, NEW.credit,
        NEW.amount, NEW.currency, NEW."externalId", NEW."statementBalance", NEW.source, NEW."importId", NEW."importLine", NEW."dedupeKey")
       IS DISTINCT FROM
       (OLD."businessId", OLD."financialAccountId", OLD."transactionDate", OLD."valueDate", OLD.reference, OLD.description, OLD.debit, OLD.credit,
        OLD.amount, OLD.currency, OLD."externalId", OLD."statementBalance", OLD.source, OLD."importId", OLD."importLine", OLD."dedupeKey") THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: statement line % is evidence and never changes', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."reconciliationId" IS NOT NULL THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: statement line % is reconciled and final', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."matchedAmount" <> 0 OR NEW."reconciliationId" IS NOT NULL THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a statement line starts unmatched' USING ERRCODE = 'check_violation';
  END IF;
  -- matchedAmount is DERIVED: whatever a writer put there, it is the Σ of the line's ACTIVE matches.
  IF TG_OP = 'UPDATE' THEN
    NEW."matchedAmount" := (SELECT coalesce(sum(amount), 0) FROM "BankTransactionMatch" WHERE "bankTransactionId" = NEW.id AND status = 'ACTIVE');
  END IF;
  NEW.status := CASE
    WHEN NEW."reconciliationId" IS NOT NULL THEN 'RECONCILED'
    WHEN NEW."matchedAmount" = abs(NEW.amount) THEN 'MATCHED'
    WHEN NEW."adjustmentRequired" THEN 'ADJUSTMENT_REQUIRED'
    WHEN NEW."matchedAmount" > 0 THEN 'PARTIALLY_MATCHED'
    ELSE 'UNMATCHED' END::"BankTransactionStatus";
  RETURN NEW;
END $$;
