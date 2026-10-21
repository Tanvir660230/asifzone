-- Partners: roles and the confirmed monthly profit share (docs/FINANCE_EQUITY.md §8).

CREATE TYPE "PartnerRole" AS ENUM ('OWNER', 'WORKING', 'INVESTOR');
CREATE TYPE "ProfitShareLossRule" AS ENUM ('ZERO_IN_LOSS_MONTHS', 'CARRY_LOSSES');

ALTER TABLE "Partner"
  ADD COLUMN "role" "PartnerRole" NOT NULL DEFAULT 'INVESTOR',
  ADD COLUMN "profitSharePct" DECIMAL(7,4),
  ADD COLUMN "shareFrom" DATE,
  ADD COLUMN "lossRule" "ProfitShareLossRule" NOT NULL DEFAULT 'ZERO_IN_LOSS_MONTHS',
  ADD COLUMN "shareConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "shareConfirmedNote" TEXT;
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_profit_share_values" CHECK ("profitSharePct" IS NULL OR ("profitSharePct" > 0 AND "profitSharePct" <= 100));
-- One owner per business.
CREATE UNIQUE INDEX "Partner_one_owner" ON "Partner"("businessId") WHERE "role" = 'OWNER';

CREATE TABLE "ProfitShare" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "netProfit" DECIMAL(18,2) NOT NULL,
    "sharePct" DECIMAL(7,4) NOT NULL,
    "monthShare" DECIMAL(18,2) NOT NULL,
    "corrections" JSONB NOT NULL DEFAULT '[]',
    "amount" DECIMAL(18,2) NOT NULL,
    "carried" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "eventId" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfitShare_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProfitShare_values" CHECK ("period" ~ '^\d{4}-(0[1-9]|1[0-2])$' AND "periodEnd" >= "periodStart" AND "amount" >= 0 AND "monthShare" >= 0 AND "carried" <= 0)
);
CREATE UNIQUE INDEX "ProfitShare_partnerId_period_key" ON "ProfitShare"("partnerId", "period");
CREATE INDEX "ProfitShare_businessId_period_idx" ON "ProfitShare"("businessId", "period");
ALTER TABLE "ProfitShare" ADD CONSTRAINT "ProfitShare_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProfitShare" ADD CONSTRAINT "ProfitShare_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A posted share is history: never edited or deleted (outside a test purge), never truncated.
CREATE OR REPLACE FUNCTION profit_share_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' AND NEW."eventId" IS DISTINCT FROM OLD."eventId" AND OLD."eventId" IS NULL
     AND NEW."amount" = OLD."amount" AND NEW."period" = OLD."period" AND NEW."partnerId" = OLD."partnerId" THEN
    RETURN NEW; -- the event id is attached once, right after the share is recorded
  END IF;
  RAISE EXCEPTION 'A profit share is never changed or deleted — a later difference is settled in the next month';
END $$;
CREATE TRIGGER "ProfitShare_immutable" BEFORE UPDATE OR DELETE ON "ProfitShare" FOR EACH ROW EXECUTE FUNCTION profit_share_immutable();
CREATE TRIGGER "ProfitShare_no_truncate" BEFORE TRUNCATE ON "ProfitShare" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
