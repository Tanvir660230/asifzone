-- Financial Core Phase 1 (docs/FINANCE_PHASE_1.md §4.7), F-10: TRUNCATE fires no row-level trigger, so it would bypass every
-- immutability rule of 20261011100000 (posted journals, the append-only audit trail, posted opening balances, final events)
-- at once. A statement-level BEFORE TRUNCATE trigger refuses it on every ledger table unless the session has explicitly
-- opted into maintenance purge (SET LOCAL finance.maintenance_purge = 'on' — test databases only, never application code).

CREATE OR REPLACE FUNCTION finance_truncate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: % can''t be truncated; the books are append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER "FinanceBusiness_no_truncate" BEFORE TRUNCATE ON "FinanceBusiness" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "FinanceBrand_no_truncate" BEFORE TRUNCATE ON "FinanceBrand" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "LedgerAccount_no_truncate" BEFORE TRUNCATE ON "LedgerAccount" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "AccountMapping_no_truncate" BEFORE TRUNCATE ON "AccountMapping" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "FinancialAccount_no_truncate" BEFORE TRUNCATE ON "FinancialAccount" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "FinancialPeriod_no_truncate" BEFORE TRUNCATE ON "FinancialPeriod" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "FinanceSequence_no_truncate" BEFORE TRUNCATE ON "FinanceSequence" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "JournalEntry_no_truncate" BEFORE TRUNCATE ON "JournalEntry" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "JournalLine_no_truncate" BEFORE TRUNCATE ON "JournalLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "FinancialEvent_no_truncate" BEFORE TRUNCATE ON "FinancialEvent" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "FinanceAuditEntry_no_truncate" BEFORE TRUNCATE ON "FinanceAuditEntry" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "OpeningBalanceBatch_no_truncate" BEFORE TRUNCATE ON "OpeningBalanceBatch" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "OpeningBalanceLine_no_truncate" BEFORE TRUNCATE ON "OpeningBalanceLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "OpeningInventoryItem_no_truncate" BEFORE TRUNCATE ON "OpeningInventoryItem" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "ReconciliationRun_no_truncate" BEFORE TRUNCATE ON "ReconciliationRun" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
