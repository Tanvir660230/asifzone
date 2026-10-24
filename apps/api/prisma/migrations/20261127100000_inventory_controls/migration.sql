-- Inventory recovery (2026-10-24): the owner alert threshold for inventory gains booked to 5210 (count adjustments).
-- Additive; the default keeps every installation's behaviour until the owner changes it.
ALTER TABLE "FinanceBusiness" ADD COLUMN "inventoryGainAlertThreshold" DECIMAL(18,2) NOT NULL DEFAULT 1000;
