-- A lower-profit or already-paid correction (negative amount) can now be rejected: the owner decides the partner keeps
-- the share as it was. A rejected correction posts nothing, so it may keep its negative figure for the record.
ALTER TABLE "ProfitShareAdjustment" DROP CONSTRAINT "ProfitShareAdjustment_values";
ALTER TABLE "ProfitShareAdjustment" ADD CONSTRAINT "ProfitShareAdjustment_values" CHECK ("period" ~ '^\d{4}-(0[1-9]|1[0-2])$' AND "amount" <> 0 AND ("amount" > 0 OR "status" IN ('POLICY_REVIEW', 'REJECTED') OR "kind" IN ('DUPLICATE_POSTING', 'INVALID_POSTING')));
