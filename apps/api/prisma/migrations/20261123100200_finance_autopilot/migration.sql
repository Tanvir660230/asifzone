-- Autopilot (docs/FINANCE_OWNER_BOOKS.md §15): nightly payout import, owner drawings and partners' profit shares.
ALTER TABLE "FinanceBusiness"
  ADD COLUMN "autoPayoutAccountId" TEXT,
  ADD COLUMN "autoPayoutsToOwner" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoProfitShares" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autopilotLastRun" JSONB;
