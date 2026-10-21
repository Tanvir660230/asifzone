-- Stock check (docs/FINANCE_CENTER.md §7): physical counts beside the site's stock, and rolls of a material.

CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "countDate" DATE NOT NULL,
    "counted" INTEGER NOT NULL,
    "siteStock" INTEGER NOT NULL,
    "note" TEXT,
    "countedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StockCount_counted" CHECK ("counted" >= 0)
);
CREATE INDEX "StockCount_variantId_countDate_idx" ON "StockCount"("variantId", "countDate");
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MaterialRoll" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "materialVariantId" TEXT NOT NULL,
    "openedOn" DATE NOT NULL,
    "finishedOn" DATE,
    "parcelsCounted" INTEGER,
    "note" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaterialRoll_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MaterialRoll_dates" CHECK ("finishedOn" IS NULL OR "finishedOn" >= "openedOn"),
    CONSTRAINT "MaterialRoll_parcels" CHECK ("parcelsCounted" IS NULL OR "parcelsCounted" > 0)
);
CREATE INDEX "MaterialRoll_materialVariantId_openedOn_idx" ON "MaterialRoll"("materialVariantId", "openedOn");
ALTER TABLE "MaterialRoll" ADD CONSTRAINT "MaterialRoll_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialRoll" ADD CONSTRAINT "MaterialRoll_materialVariantId_fkey" FOREIGN KEY ("materialVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A count is a record of what was seen: never edited or deleted (outside a test purge), never truncated.
CREATE OR REPLACE FUNCTION stock_count_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'A stock count is never changed or deleted — record a new count';
END $$;
CREATE TRIGGER "StockCount_immutable" BEFORE UPDATE OR DELETE ON "StockCount" FOR EACH ROW EXECUTE FUNCTION stock_count_immutable();
CREATE TRIGGER "StockCount_no_truncate" BEFORE TRUNCATE ON "StockCount" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "MaterialRoll_no_truncate" BEFORE TRUNCATE ON "MaterialRoll" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
