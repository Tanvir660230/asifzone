-- Owner's books §3–§4 (docs/FINANCE_OWNER_BOOKS.md): courier rate cards and gateway fee rates (estimates until the payout), and
-- settlement lines that carry only a charge (a returned parcel: nothing collected, a return charge deducted).

-- CreateTable
CREATE TABLE "CourierRateCard" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "courier" TEXT NOT NULL DEFAULT 'STEADFAST',
    "effectiveFrom" DATE NOT NULL,
    "zones" JSONB NOT NULL,
    "defaultCharge" DECIMAL(18,2) NOT NULL,
    "codPercent" DECIMAL(6,3) NOT NULL,
    "returnChargePercent" DECIMAL(6,3) NOT NULL,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierRateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayFeeRate" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "percent" DECIMAL(6,3) NOT NULL,
    "fixed" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayFeeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourierRateCard_businessId_courier_effectiveFrom_key" ON "CourierRateCard"("businessId", "courier", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayFeeRate_businessId_provider_effectiveFrom_key" ON "GatewayFeeRate"("businessId", "provider", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "CourierRateCard" ADD CONSTRAINT "CourierRateCard_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayFeeRate" ADD CONSTRAINT "GatewayFeeRate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- R-1 rates are percentages between 0 and 100, fees never negative; a card's zones are a JSON array
ALTER TABLE "CourierRateCard" ADD CONSTRAINT "CourierRateCard_values" CHECK (
  "defaultCharge" >= 0 AND "codPercent" BETWEEN 0 AND 100 AND "returnChargePercent" BETWEEN 0 AND 200 AND jsonb_typeof("zones") = 'array');
ALTER TABLE "GatewayFeeRate" ADD CONSTRAINT "GatewayFeeRate_values" CHECK ("percent" BETWEEN 0 AND 100 AND "fixed" >= 0);
CREATE TRIGGER "CourierRateCard_no_truncate" BEFORE TRUNCATE ON "CourierRateCard" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "GatewayFeeRate_no_truncate" BEFORE TRUNCATE ON "GatewayFeeRate" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();

-- R-2 a settlement line may carry only a charge or an adjustment (a returned parcel's return charge): nothing collected
ALTER TABLE "ClearingSettlementLine" DROP CONSTRAINT "ClearingSettlementLine_amounts";
ALTER TABLE "ClearingSettlementLine" ADD CONSTRAINT "ClearingSettlementLine_amounts" CHECK (
  "amount" >= 0 AND "fee" >= 0 AND ("amount" > 0 OR "fee" > 0 OR "adjustment" <> 0));
