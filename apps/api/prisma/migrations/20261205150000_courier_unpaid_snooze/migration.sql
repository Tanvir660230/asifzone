-- Blueprint P1.2 (tab 2 §3): the owner can snooze the "Unpaid by Steadfast" Home reminder until a date. Additive, NULL = not snoozed.
ALTER TABLE "FinanceBusiness" ADD COLUMN "courierUnpaidSnoozedUntil" DATE;
