-- Owner decision Q-B: one follow-up deadline for parcels coming back. StoreSetting.returnNotBackDays (Order Operations,
-- on Settings › Dispatch, read by Orders › Return overdue and the daily courier check) is the one; the ERP core's
-- FinanceBusiness.returnFollowUpDays (Home's "Parcels to receive", no screen) is folded into it.
--
-- A store that changed only the old setting keeps its deadline: the value moves across when returnNotBackDays is still at
-- its default 14 and the old one is not. When both were changed, returnNotBackDays (the one the owner sees) stays. The
-- Settings range is 3–60 days; a value outside it is brought inside, with a NOTICE in the migration log.
DO $$
DECLARE
  days INTEGER;
  kept INTEGER;
BEGIN
  SELECT MIN("returnFollowUpDays") INTO days
  FROM "FinanceBusiness"
  WHERE "returnFollowUpDays" <> 14
  HAVING COUNT(DISTINCT "returnFollowUpDays") = 1;

  IF days IS NOT NULL THEN
    kept := LEAST(60, GREATEST(3, days));
    IF kept <> days THEN
      RAISE NOTICE 'returnFollowUpDays % is outside 3-60; returnNotBackDays set to %', days, kept;
    END IF;
    INSERT INTO "StoreSetting" ("id", "returnNotBackDays", "updatedAt")
    VALUES ('singleton', kept, NOW())
    ON CONFLICT ("id") DO UPDATE SET "returnNotBackDays" = EXCLUDED."returnNotBackDays", "updatedAt" = NOW()
    WHERE "StoreSetting"."returnNotBackDays" = 14;
  END IF;
END $$;

-- The old column stays, no longer read: migrations only add (a rollback must still find what the previous code reads —
-- src/domain/identity/phase11.guard.test.ts refuses DROP COLUMN).
