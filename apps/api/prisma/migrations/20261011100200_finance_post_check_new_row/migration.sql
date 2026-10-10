-- Financial Core Phase 1 (docs/FINANCE_PHASE_1.md §4.7): fix of 20261011100000. finance_assert_postable(id) re-read the
-- journal with SELECT, which inside the BEFORE UPDATE trigger returns the row as it was BEFORE the update (status DRAFT,
-- number/postedAt NULL, the old period) — so every DRAFT → POSTED transition was refused. The check now takes the row: the
-- BEFORE trigger passes NEW (the values being written); the deferred commit check passes the row as committed.

CREATE OR REPLACE FUNCTION finance_assert_postable_row(e "JournalEntry") RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  p record; b record;
  n_lines int; s_debit numeric; s_credit numeric; bad_lines int;
BEGIN
  SELECT count(*), coalesce(sum("debit"), 0), coalesce(sum("credit"), 0) INTO n_lines, s_debit, s_credit
    FROM "JournalLine" WHERE "entryId" = e.id;
  IF n_lines < 2 THEN RAISE EXCEPTION 'FINANCE_INVARIANT: journal % has % line(s); at least 2 required', e.id, n_lines USING ERRCODE = 'check_violation'; END IF;
  IF s_debit <> s_credit THEN RAISE EXCEPTION 'FINANCE_INVARIANT: journal % is unbalanced (debit %, credit %)', e.id, s_debit, s_credit USING ERRCODE = 'check_violation'; END IF;
  IF s_debit = 0 THEN RAISE EXCEPTION 'FINANCE_INVARIANT: journal % moves no amount', e.id USING ERRCODE = 'check_violation'; END IF;
  IF s_debit <> e."totalDebit" OR s_credit <> e."totalCredit" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: journal % totals (%/%) differ from its lines (%/%)', e.id, e."totalDebit", e."totalCredit", s_debit, s_credit USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO bad_lines FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id = l."accountId"
    WHERE l."entryId" = e.id AND (NOT a."isPostable" OR NOT a."isActive" OR a."businessId" <> e."businessId");
  IF bad_lines > 0 THEN RAISE EXCEPTION 'FINANCE_INVARIANT: journal % posts to a group, inactive or foreign account', e.id USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO p FROM "FinancialPeriod" WHERE id = e."periodId";
  IF NOT FOUND OR p."businessId" <> e."businessId" OR e."entryDate" < p."startDate" OR e."entryDate" > p."endDate" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: journal % date % is outside its period', e.id, e."entryDate" USING ERRCODE = 'check_violation';
  END IF;
  IF p.status = 'CLOSED' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: period % is closed', p."startDate" USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO b FROM "FinanceBusiness" WHERE id = e."businessId";
  IF b."openingDate" IS NULL THEN RAISE EXCEPTION 'FINANCE_INVARIANT: the financial opening date is not set' USING ERRCODE = 'check_violation'; END IF;
  IF e."entryDate" < b."openingDate" THEN RAISE EXCEPTION 'FINANCE_INVARIANT: journal % is dated before the opening date %', e.id, b."openingDate" USING ERRCODE = 'check_violation'; END IF;
  IF e.kind = 'OPENING_BALANCE' AND e."entryDate" <> b."openingDate" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: opening balances must be dated on the opening date' USING ERRCODE = 'check_violation';
  END IF;
  IF e.number IS NULL OR e."postedAt" IS NULL THEN RAISE EXCEPTION 'FINANCE_INVARIANT: posted journal % lacks number/postedAt', e.id USING ERRCODE = 'check_violation'; END IF;
END $$;

-- By id: the row as it stands now (used by the deferred commit check, where the latest version is what commits).
CREATE OR REPLACE FUNCTION finance_assert_postable(p_entry_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e "JournalEntry";
BEGIN
  SELECT * INTO e FROM "JournalEntry" WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM finance_assert_postable_row(e);
END $$;

CREATE OR REPLACE FUNCTION finance_journal_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'POSTED' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: a journal is created as DRAFT and posted by a status change' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: posted journal % is immutable (reverse it instead)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'POSTED' THEN PERFORM finance_assert_postable_row(NEW); END IF;
    RETURN NEW;
  ELSE
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: posted journal % cannot be deleted', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
END $$;
