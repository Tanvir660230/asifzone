-- Owner's books §5–§6 (docs/FINANCE_OWNER_BOOKS.md): ad campaigns and their daily spend, prepaid costs spread over their
-- service period, and packing rules (packaging a parcel uses).

-- CreateEnum
CREATE TYPE "AdBudgetType" AS ENUM ('DAILY', 'LIFETIME');

-- CreateEnum
CREATE TYPE "PackingRuleScope" AS ENUM ('EVERY_PARCEL', 'CATEGORY', 'PRODUCT', 'VARIANT');

-- CreateEnum
CREATE TYPE "PackingRulePer" AS ENUM ('PARCEL', 'UNIT');

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'META',
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "budgetType" "AdBudgetType",
    "budget" DECIMAL(18,2),
    "landingPath" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSpendDay" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "originalAmount" DECIMAL(18,2),
    "originalCurrency" VARCHAR(3),
    "fxRate" DECIMAL(18,6),
    "impressions" INTEGER,
    "clicks" INTEGER,
    "purchases" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdSpendDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepaidCost" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "serviceStart" DATE NOT NULL,
    "serviceEnd" DATE NOT NULL,
    "movementId" TEXT NOT NULL,
    "payee" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrepaidCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingRule" (
    "id" TEXT NOT NULL,
    "scope" "PackingRuleScope" NOT NULL,
    "scopeId" TEXT,
    "materialVariantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "per" "PackingRulePer" NOT NULL DEFAULT 'PARCEL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdCampaign_businessId_startDate_idx" ON "AdCampaign"("businessId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaign_financialAccountId_externalId_key" ON "AdCampaign"("financialAccountId", "externalId");

-- CreateIndex
CREATE INDEX "AdSpendDay_date_idx" ON "AdSpendDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AdSpendDay_campaignId_date_key" ON "AdSpendDay"("campaignId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PrepaidCost_movementId_key" ON "PrepaidCost"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "PrepaidCost_businessId_number_key" ON "PrepaidCost"("businessId", "number");

-- CreateIndex
CREATE INDEX "PackingRule_isActive_idx" ON "PackingRule"("isActive");

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpendDay" ADD CONSTRAINT "AdSpendDay_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepaidCost" ADD CONSTRAINT "PrepaidCost_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepaidCost" ADD CONSTRAINT "PrepaidCost_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepaidCost" ADD CONSTRAINT "PrepaidCost_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingRule" ADD CONSTRAINT "PackingRule_materialVariantId_fkey" FOREIGN KEY ("materialVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A-1 values
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_values" CHECK (
  length(btrim("name")) > 0 AND ("endDate" IS NULL OR "endDate" >= "startDate")
  AND (("budgetType" IS NULL) = ("budget" IS NULL)) AND ("budget" IS NULL OR "budget" > 0)
  AND ("budgetType" IS DISTINCT FROM 'LIFETIME' OR "endDate" IS NOT NULL));
ALTER TABLE "AdSpendDay" ADD CONSTRAINT "AdSpendDay_values" CHECK ("amount" >= 0 AND "source" IN ('META_API', 'MANUAL'));
ALTER TABLE "PrepaidCost" ADD CONSTRAINT "PrepaidCost_values" CHECK ("amount" > 0 AND "serviceEnd" >= "serviceStart" AND length(btrim("name")) > 0);
ALTER TABLE "PackingRule" ADD CONSTRAINT "PackingRule_values" CHECK ("quantity" > 0 AND (("scope" = 'EVERY_PARCEL') = ("scopeId" IS NULL)));

-- A-2 a prepaid cost is the record of its payment: its amount and money never change (reverse the payment); only the
--     name, notes and the end of service may
CREATE OR REPLACE FUNCTION finance_prepaid_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a prepaid cost is history (reverse its payment)' USING ERRCODE = 'check_violation'; END IF;
  IF (NEW."businessId", NEW.number, NEW."expenseAccountId", NEW.amount, NEW."serviceStart", NEW."movementId")
     IS DISTINCT FROM (OLD."businessId", OLD.number, OLD."expenseAccountId", OLD.amount, OLD."serviceStart", OLD."movementId") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a prepaid cost''s amount, account, start and payment never change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PrepaidCost_guard" BEFORE UPDATE OR DELETE ON "PrepaidCost" FOR EACH ROW EXECUTE FUNCTION finance_prepaid_guard();

-- A-3 the payment is a WITHDRAWAL of the prepaid amount
CREATE OR REPLACE FUNCTION finance_prepaid_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m record;
BEGIN
  SELECT kind::text AS kind, amount, "businessId" INTO m FROM "TreasuryMovement" WHERE id = NEW."movementId";
  IF m.kind <> 'WITHDRAWAL' OR m.amount <> NEW.amount OR m."businessId" <> NEW."businessId" THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a prepaid cost is a withdrawal of its amount' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PrepaidCost_movement" BEFORE INSERT ON "PrepaidCost" FOR EACH ROW EXECUTE FUNCTION finance_prepaid_movement();

CREATE TRIGGER "AdCampaign_no_truncate" BEFORE TRUNCATE ON "AdCampaign" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "AdSpendDay_no_truncate" BEFORE TRUNCATE ON "AdSpendDay" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "PrepaidCost_no_truncate" BEFORE TRUNCATE ON "PrepaidCost" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
