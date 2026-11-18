-- Monthly targets (docs/superpowers/plans/2026-11-18-business-reports.md, Part 1): one row per store-local month.
CREATE TABLE "MonthlyTarget" (
    "month" TEXT NOT NULL,
    "netSales" DECIMAL(14,2),
    "orders" INTEGER,
    "profit" DECIMAL(14,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "MonthlyTarget_pkey" PRIMARY KEY ("month"),
    -- "2026-11": a real month, so a typo can't create a target nobody sees
    CONSTRAINT "MonthlyTarget_month_format" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    -- a target is a positive number or not set; profit may be any amount above zero too (a loss is not a target)
    CONSTRAINT "MonthlyTarget_positive" CHECK (("netSales" IS NULL OR "netSales" > 0) AND ("orders" IS NULL OR "orders" > 0) AND ("profit" IS NULL OR "profit" > 0))
);

ALTER TABLE "MonthlyTarget" ADD CONSTRAINT "MonthlyTarget_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
