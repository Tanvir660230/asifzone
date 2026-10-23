-- Partner finance phase 3 (the closed-and-verified month, rates by month, corrections): new tables only; nothing existing
-- changes. The backfill at the end copies the shares already made into the new tables; nothing is posted.

-- CreateEnum
CREATE TYPE "ProfitSharePeriodStatus" AS ENUM ('PREPARED', 'VERIFIED', 'POSTED', 'POSTING_FAILED', 'RESTATEMENT_WATCH');

-- CreateEnum
CREATE TYPE "ProfitShareAdjustmentKind" AS ENUM ('PROFIT_RESTATEMENT_UP', 'PROFIT_RESTATEMENT_DOWN', 'DUPLICATE_POSTING', 'INVALID_POSTING');

-- CreateEnum
CREATE TYPE "ProfitShareAdjustmentStatus" AS ENUM ('PROPOSED', 'POSTED', 'REJECTED', 'POLICY_REVIEW');

-- CreateTable
CREATE TABLE "PartnerShareRate" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "pct" DECIMAL(7,4),
    "effectiveFrom" DATE NOT NULL,
    "note" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerShareRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitSharePeriod" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "ProfitSharePeriodStatus" NOT NULL,
    "netProfit" DECIMAL(18,2),
    "readiness" JSONB NOT NULL DEFAULT '{}',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "preparedAt" TIMESTAMP(3),
    "preparedByAdminId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByAdminId" TEXT,
    "postedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitSharePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitShareAdjustment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "kind" "ProfitShareAdjustmentKind" NOT NULL,
    "status" "ProfitShareAdjustmentStatus" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "sharePct" DECIMAL(7,4),
    "profitThen" DECIMAL(18,2),
    "profitNow" DECIMAL(18,2),
    "reason" TEXT NOT NULL,
    "relatedEntryId" TEXT,
    "proposedByAdminId" TEXT,
    "decidedByAdminId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "eventId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfitShareAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerShareRate_partnerId_effectiveFrom_key" ON "PartnerShareRate"("partnerId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ProfitSharePeriod_businessId_period_key" ON "ProfitSharePeriod"("businessId", "period");

-- CreateIndex
CREATE INDEX "ProfitShareAdjustment_partnerId_period_idx" ON "ProfitShareAdjustment"("partnerId", "period");

-- CreateIndex
CREATE INDEX "TreasuryMovement_counterAccountId_status_idx" ON "TreasuryMovement"("counterAccountId", "status");

-- AddForeignKey
ALTER TABLE "PartnerShareRate" ADD CONSTRAINT "PartnerShareRate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerShareRate" ADD CONSTRAINT "PartnerShareRate_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitSharePeriod" ADD CONSTRAINT "ProfitSharePeriod_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitShareAdjustment" ADD CONSTRAINT "ProfitShareAdjustment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitShareAdjustment" ADD CONSTRAINT "ProfitShareAdjustment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── rules the database keeps ─────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "PartnerShareRate" ADD CONSTRAINT "PartnerShareRate_values" CHECK (("pct" IS NULL OR ("pct" > 0 AND "pct" <= 100)) AND "effectiveFrom" = date_trunc('month', "effectiveFrom")::date);
ALTER TABLE "ProfitSharePeriod" ADD CONSTRAINT "ProfitSharePeriod_period" CHECK ("period" ~ '^\d{4}-(0[1-9]|1[0-2])$');
-- Only a duplicate / wrong posting's reversal debits a partner; a lower profit is a POLICY_REVIEW item that posts nothing.
ALTER TABLE "ProfitShareAdjustment" ADD CONSTRAINT "ProfitShareAdjustment_values" CHECK ("period" ~ '^\d{4}-(0[1-9]|1[0-2])$' AND "amount" <> 0 AND ("amount" > 0 OR "status" = 'POLICY_REVIEW' OR "kind" IN ('DUPLICATE_POSTING', 'INVALID_POSTING')));

-- A rate a shared month used is never changed or deleted (a new rate starts after the last shared month).
CREATE OR REPLACE FUNCTION partner_share_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF EXISTS (SELECT 1 FROM "ProfitShare" s WHERE s."partnerId" = OLD."partnerId" AND s."periodStart" >= OLD."effectiveFrom") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a profit-share rate a shared month used is never changed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "PartnerShareRate_guard" BEFORE UPDATE OR DELETE ON "PartnerShareRate" FOR EACH ROW EXECUTE FUNCTION partner_share_rate_guard();
CREATE TRIGGER "PartnerShareRate_no_truncate" BEFORE TRUNCATE ON "PartnerShareRate" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();

-- A correction is never deleted, and once decided (posted or rejected) never changed.
CREATE OR REPLACE FUNCTION profit_share_adjustment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a profit-share adjustment is never deleted'; END IF;
  IF OLD."status" IN ('POSTED', 'REJECTED') THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a decided profit-share adjustment is never changed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProfitShareAdjustment_guard" BEFORE UPDATE OR DELETE ON "ProfitShareAdjustment" FOR EACH ROW EXECUTE FUNCTION profit_share_adjustment_guard();
CREATE TRIGGER "ProfitShareAdjustment_no_truncate" BEFORE TRUNCATE ON "ProfitShareAdjustment" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "ProfitSharePeriod_no_truncate" BEFORE TRUNCATE ON "ProfitSharePeriod" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();

-- ── backfill from the shares already made (deterministic; nothing is posted, no balance moves) ───────────────────────
-- Rates: one row at every month a partner's shared rate changed …
INSERT INTO "PartnerShareRate" ("id", "businessId", "partnerId", "pct", "effectiveFrom", "note", "createdAt")
SELECT 'psr_' || md5(s."partnerId" || s."periodStart"::text), s."businessId", s."partnerId", s."sharePct", s."periodStart", 'From the month''s share (backfill)', now()
FROM (SELECT ps.*, lag(ps."sharePct") OVER (PARTITION BY ps."partnerId" ORDER BY ps."period") AS prev FROM "ProfitShare" ps) s
WHERE s.prev IS NULL OR s.prev <> s."sharePct";
-- … and the partner's current rate from the month after their last share (or their start), when it differs.
INSERT INTO "PartnerShareRate" ("id", "businessId", "partnerId", "pct", "effectiveFrom", "note", "createdAt")
SELECT 'psr_' || md5(p."id" || x.start::text), p."businessId", p."id", p."profitSharePct", x.start, 'Current rate (backfill)', now()
FROM "Partner" p
CROSS JOIN LATERAL (
  SELECT COALESCE((SELECT (max(ps."periodStart") + interval '1 month')::date FROM "ProfitShare" ps WHERE ps."partnerId" = p."id"),
                  date_trunc('month', COALESCE(p."shareFrom", p."joinedOn"))::date) AS start
) x
WHERE p."role" <> 'OWNER'
  AND (p."profitSharePct" IS NOT NULL OR EXISTS (SELECT 1 FROM "ProfitShare" ps WHERE ps."partnerId" = p."id"))
  AND p."profitSharePct" IS DISTINCT FROM (SELECT ps."sharePct" FROM "ProfitShare" ps WHERE ps."partnerId" = p."id" ORDER BY ps."period" DESC LIMIT 1)
ON CONFLICT ("partnerId", "effectiveFrom") DO NOTHING;
-- Months already shared: POSTED when every share with an amount is in the books, else POSTING_FAILED (retried from the page).
INSERT INTO "ProfitSharePeriod" ("id", "businessId", "period", "status", "netProfit", "readiness", "postedAt", "createdAt", "updatedAt")
SELECT 'pspd_' || md5(ps."businessId" || ps."period"), ps."businessId", ps."period",
       CASE WHEN bool_and(ps."amount" = 0 OR e."status" = 'POSTED') THEN 'POSTED'::"ProfitSharePeriodStatus" ELSE 'POSTING_FAILED'::"ProfitSharePeriodStatus" END,
       min(ps."netProfit"), '{"backfill": true}'::jsonb, max(ps."createdAt"), now(), now()
FROM "ProfitShare" ps LEFT JOIN "FinancialEvent" e ON e."id" = ps."eventId"
GROUP BY ps."businessId", ps."period";

