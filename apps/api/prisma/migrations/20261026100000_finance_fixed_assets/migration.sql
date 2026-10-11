-- ERP E9 — fixed assets and depreciation (docs/FINANCE_FIXED_ASSETS.md)

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'DECLINING_BALANCE');

-- CreateEnum
CREATE TYPE "FixedAssetStatus" AS ENUM ('IN_USE', 'DISPOSED');

-- CreateEnum
CREATE TYPE "DepreciationRunStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "assetAccountId" TEXT NOT NULL,
    "acquisitionDate" DATE NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL,
    "residualValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "method" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "decliningRatePct" DECIMAL(7,4),
    "depreciationStart" TEXT NOT NULL,
    "openingAccumulatedDepreciation" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "location" TEXT,
    "custodian" TEXT,
    "serialNumber" TEXT,
    "notes" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'IN_USE',
    "disposedAt" DATE,
    "disposalProceeds" DECIMAL(18,2),
    "disposalFinancialAccountId" TEXT,
    "disposalGainLoss" DECIMAL(18,2),
    "disposalReason" TEXT,
    "disposalJournalId" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepreciationRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "status" "DepreciationRunStatus" NOT NULL DEFAULT 'POSTED',
    "total" DECIMAL(18,2) NOT NULL,
    "journalEntryId" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,

    CONSTRAINT "DepreciationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepreciationLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "DepreciationLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_disposalJournalId_key" ON "FixedAsset"("disposalJournalId");

-- CreateIndex
CREATE INDEX "FixedAsset_businessId_status_idx" ON "FixedAsset"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_businessId_number_key" ON "FixedAsset"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationRun_journalEntryId_key" ON "DepreciationRun"("journalEntryId");

-- CreateIndex
CREATE INDEX "DepreciationRun_businessId_periodKey_idx" ON "DepreciationRun"("businessId", "periodKey");

-- CreateIndex
CREATE INDEX "DepreciationLine_assetId_idx" ON "DepreciationLine"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationLine_runId_assetId_key" ON "DepreciationLine"("runId", "assetId");

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_disposalFinancialAccountId_fkey" FOREIGN KEY ("disposalFinancialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_disposalJournalId_fkey" FOREIGN KEY ("disposalJournalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationRun" ADD CONSTRAINT "DepreciationRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationRun" ADD CONSTRAINT "DepreciationRun_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationLine" ADD CONSTRAINT "DepreciationLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DepreciationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationLine" ADD CONSTRAINT "DepreciationLine_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A-1 values: cost > 0, 0 ≤ residual < cost, a positive life, a declining rate only for that method, opening depreciation
--     within cost − residual, months as YYYY-MM; DISPOSED carries its date, journal and result
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_values" CHECK (
  "cost" > 0 AND "residualValue" >= 0 AND "residualValue" < "cost" AND "usefulLifeMonths" > 0 AND "usefulLifeMonths" <= 1200
  AND (("method" = 'DECLINING_BALANCE') = ("decliningRatePct" IS NOT NULL)) AND ("decliningRatePct" IS NULL OR ("decliningRatePct" > 0 AND "decliningRatePct" <= 100))
  AND "openingAccumulatedDepreciation" >= 0 AND "openingAccumulatedDepreciation" <= "cost" - "residualValue"
  AND "depreciationStart" ~ '^\d{4}-(0[1-9]|1[0-2])$' AND length(btrim("name")) > 0
  AND (("status" = 'DISPOSED') = ("disposedAt" IS NOT NULL)) AND ("status" = 'IN_USE' OR ("disposalJournalId" IS NOT NULL AND "disposalGainLoss" IS NOT NULL AND "disposalProceeds" IS NOT NULL)));
ALTER TABLE "DepreciationRun" ADD CONSTRAINT "DepreciationRun_values" CHECK (
  "periodKey" ~ '^\d{4}-(0[1-9]|1[0-2])$' AND "total" >= 0 AND (("status" = 'REVERSED') = ("reversedAt" IS NOT NULL)) AND ("status" = 'POSTED' OR "reversalReason" IS NOT NULL));
ALTER TABLE "DepreciationLine" ADD CONSTRAINT "DepreciationLine_values" CHECK ("amount" > 0);
-- one live run per month
CREATE UNIQUE INDEX "DepreciationRun_one_per_month" ON "DepreciationRun"("businessId", "periodKey") WHERE "status" = 'POSTED';

-- A-2 an asset's depreciation basis is fixed once a run has used it; a disposal is final
CREATE OR REPLACE FUNCTION finance_fixed_asset_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "DepreciationLine" WHERE "assetId" = OLD.id) OR OLD.status = 'DISPOSED' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: an asset with depreciation or a disposal is never deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'DISPOSED' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a disposed asset is final' USING ERRCODE = 'check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM "DepreciationLine" l JOIN "DepreciationRun" r ON r.id = l."runId" WHERE l."assetId" = OLD.id AND r.status = 'POSTED')
     AND (NEW."businessId", NEW.number, NEW."assetAccountId", NEW."acquisitionDate", NEW.cost, NEW."residualValue", NEW."usefulLifeMonths", NEW.method, NEW."decliningRatePct", NEW."depreciationStart", NEW."openingAccumulatedDepreciation")
         IS DISTINCT FROM (OLD."businessId", OLD.number, OLD."assetAccountId", OLD."acquisitionDate", OLD.cost, OLD."residualValue", OLD."usefulLifeMonths", OLD.method, OLD."decliningRatePct", OLD."depreciationStart", OLD."openingAccumulatedDepreciation") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: an asset''s cost and depreciation basis are fixed once it has been depreciated' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FixedAsset_guard" BEFORE UPDATE OR DELETE ON "FixedAsset" FOR EACH ROW EXECUTE FUNCTION finance_fixed_asset_guard();

-- A-3 runs and their lines are append-only; a run only goes POSTED → REVERSED (recording that alone)
CREATE OR REPLACE FUNCTION finance_depreciation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'DepreciationRun' AND TG_OP = 'UPDATE' THEN
    IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED'
       AND (NEW."businessId", NEW."periodKey", NEW.total, NEW."journalEntryId", NEW."createdByAdminId", NEW."createdAt")
           IS NOT DISTINCT FROM (OLD."businessId", OLD."periodKey", OLD.total, OLD."journalEntryId", OLD."createdByAdminId", OLD."createdAt") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: depreciation runs are append-only (reverse the latest run)' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "DepreciationRun_guard" BEFORE UPDATE OR DELETE ON "DepreciationRun" FOR EACH ROW EXECUTE FUNCTION finance_depreciation_guard();
CREATE TRIGGER "DepreciationLine_guard" BEFORE UPDATE OR DELETE ON "DepreciationLine" FOR EACH ROW EXECUTE FUNCTION finance_depreciation_guard();

-- A-4 audit at commit, no TRUNCATE
CREATE CONSTRAINT TRIGGER "FixedAsset_audit" AFTER INSERT OR UPDATE OR DELETE ON "FixedAsset"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('FixedAsset');
CREATE CONSTRAINT TRIGGER "DepreciationRun_audit" AFTER INSERT OR UPDATE OR DELETE ON "DepreciationRun"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('DepreciationRun');
CREATE TRIGGER "FixedAsset_no_truncate" BEFORE TRUNCATE ON "FixedAsset" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "DepreciationRun_no_truncate" BEFORE TRUNCATE ON "DepreciationRun" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "DepreciationLine_no_truncate" BEFORE TRUNCATE ON "DepreciationLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
