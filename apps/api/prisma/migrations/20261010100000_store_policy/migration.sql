-- Phase 5: store policy becomes store configuration (StoreSetting) instead of storefront code.
ALTER TABLE "StoreSetting" ADD COLUMN "returnWindowDays" INTEGER;
ALTER TABLE "StoreSetting" ADD COLUMN "returnConditions" TEXT;
ALTER TABLE "StoreSetting" ADD COLUMN "handlingDaysMin" INTEGER;
ALTER TABLE "StoreSetting" ADD COLUMN "handlingDaysMax" INTEGER;

-- An existing store keeps exactly the policy its storefront has been stating (until now hard-coded in the web app):
-- a 7-day window for unworn items with tags, dispatched within 1–2 business days. A new store's row is created later,
-- empty, and states nothing until its owner sets a policy in Admin → Settings.
UPDATE "StoreSetting"
SET "returnWindowDays" = 7,
    "returnConditions" = 'Unworn items in original condition with tags attached',
    "handlingDaysMin" = 1,
    "handlingDaysMax" = 2
WHERE "id" = 'singleton';
