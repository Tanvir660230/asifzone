-- Cost & profit planning (docs/COST_SHEET.md): shop, category and product cost profiles — a planning aid, never booked.
-- CreateEnum
CREATE TYPE "CostProfileScope" AS ENUM ('BUSINESS', 'CATEGORY', 'PRODUCT');

-- CreateEnum
CREATE TYPE "CostLineKind" AS ENUM ('MAKING', 'PACKAGING', 'COURIER', 'PAYMENT_FEE', 'RETURN_RESERVE', 'ADS', 'LABOUR', 'OTHER');

-- CreateEnum
CREATE TYPE "CostLineMode" AS ENUM ('AUTO', 'FIXED', 'PERCENT_OF_PRICE');

-- CreateTable
CREATE TABLE "CostProfile" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "scope" "CostProfileScope" NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "insideDhakaPct" DECIMAL(5,2),
    "codPct" DECIMAL(5,2),
    "returnRatePct" DECIMAL(5,2),
    "targetMarginPct" DECIMAL(5,2),
    "notes" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostProfileLine" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "variantId" TEXT,
    "kind" "CostLineKind" NOT NULL,
    "mode" "CostLineMode" NOT NULL,
    "amount" DECIMAL(18,4),
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CostProfileLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CostProfile_businessId_scope_scopeId_key" ON "CostProfile"("businessId", "scope", "scopeId");

-- CreateIndex
CREATE INDEX "CostProfileLine_profileId_idx" ON "CostProfileLine"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "CostProfileLine_profileId_kind_variantId_key" ON "CostProfileLine"("profileId", "kind", "variantId");

-- AddForeignKey
ALTER TABLE "CostProfile" ADD CONSTRAINT "CostProfile_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostProfileLine" ADD CONSTRAINT "CostProfileLine_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CostProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "CostProfileLine" ADD CONSTRAINT "CostProfileLine_amount_mode" CHECK (("mode" = 'AUTO') = ("amount" IS NULL));
ALTER TABLE "CostProfile" ADD CONSTRAINT "CostProfile_pcts" CHECK (coalesce("insideDhakaPct",0) BETWEEN 0 AND 100 AND coalesce("codPct",0) BETWEEN 0 AND 100 AND coalesce("returnRatePct",0) BETWEEN 0 AND 100 AND coalesce("targetMarginPct",0) BETWEEN 0 AND 95);
