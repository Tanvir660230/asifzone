-- A period total shared over the days without their own figure (docs/FINANCE_OWNER_BOOKS.md §5.2).
ALTER TABLE "AdSpendDay" DROP CONSTRAINT "AdSpendDay_values";
ALTER TABLE "AdSpendDay" ADD CONSTRAINT "AdSpendDay_values" CHECK ("amount" >= 0 AND "source" IN ('META_API', 'MANUAL', 'CSV', 'PERIOD'));
