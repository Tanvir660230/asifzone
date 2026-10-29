-- Owner decision Q-B (blueprint rev. 3.1): the follow-up period for parcels and returns still out is a store setting.
-- Additive, with the decided default; no existing row changes meaning.
ALTER TABLE "FinanceBusiness" ADD COLUMN "returnFollowUpDays" INTEGER NOT NULL DEFAULT 14;
