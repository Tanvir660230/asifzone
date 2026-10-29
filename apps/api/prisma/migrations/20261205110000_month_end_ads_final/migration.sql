-- Blueprint P0.7 (owner decisions Q16, Q-E, I-4): campaign archive, owner-confirmed zero ad-spend days and the Final-month
-- rule's effective date. Additive only: nullable columns, and one NOT NULL column with a default (existing books get the
-- moment this migration runs, so every month closed before it keeps its Final label).
ALTER TABLE "AdCampaign" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "AdCampaign" ADD COLUMN "archivedByAdminId" TEXT;
ALTER TABLE "AdCampaign" ADD COLUMN "archiveReason" TEXT;
ALTER TABLE "AdSpendDay" ADD COLUMN "confirmedZeroAt" TIMESTAMP(3);
ALTER TABLE "AdSpendDay" ADD COLUMN "confirmedZeroByAdminId" TEXT;
ALTER TABLE "AdSpendDay" ADD COLUMN "confirmedZeroReason" TEXT;
ALTER TABLE "FinanceBusiness" ADD COLUMN "monthEndRuleEffectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
