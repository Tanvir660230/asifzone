-- The estimated cost of goods sold outside the website, as a percent of the cash collected (docs/FINANCE_OWNER_BOOKS.md).
ALTER TABLE "FinanceBusiness" ADD COLUMN "outsideSaleCostPct" DECIMAL(5,2);
ALTER TABLE "FinanceBusiness" ADD CONSTRAINT "FinanceBusiness_outside_cost_pct" CHECK ("outsideSaleCostPct" IS NULL OR ("outsideSaleCostPct" >= 0 AND "outsideSaleCostPct" <= 100));
