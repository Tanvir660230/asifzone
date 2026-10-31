-- Warehouse printing log (docs/WAREHOUSE_OPERATIONS.md §3). Additive: two new tables, no change to existing rows.
CREATE TABLE "PrintRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clientRunId" TEXT NOT NULL,
    "adminId" TEXT,
    "adminName" TEXT,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "unitCount" INTEGER NOT NULL DEFAULT 0,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "reprint" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrintRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrintRun_kind_check" CHECK ("kind" IN ('PICK_LIST', 'PACKING_SHEET', 'COURIER_LABEL', 'PRODUCT_LABEL', 'MANIFEST')),
    CONSTRAINT "PrintRun_copies_check" CHECK ("copies" BETWEEN 1 AND 50)
);

CREATE TABLE "PrintRunItem" (
    "id" TEXT NOT NULL,
    "printRunId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderId" TEXT,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "reprint" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrintRunItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrintRunItem_target_check" CHECK ("orderId" IS NOT NULL OR "variantId" IS NOT NULL)
);

CREATE UNIQUE INDEX "PrintRun_clientRunId_key" ON "PrintRun"("clientRunId");
CREATE INDEX "PrintRun_kind_createdAt_idx" ON "PrintRun"("kind", "createdAt");
CREATE INDEX "PrintRunItem_orderId_kind_idx" ON "PrintRunItem"("orderId", "kind");
CREATE INDEX "PrintRunItem_variantId_kind_idx" ON "PrintRunItem"("variantId", "kind");
CREATE INDEX "PrintRunItem_printRunId_idx" ON "PrintRunItem"("printRunId");

ALTER TABLE "PrintRunItem" ADD CONSTRAINT "PrintRunItem_printRunId_fkey" FOREIGN KEY ("printRunId") REFERENCES "PrintRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: a print happened or it didn't. Corrections are a new run, never an edit.
CREATE OR REPLACE FUNCTION print_run_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Print history is append-only (%)', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PrintRun_append_only" BEFORE UPDATE OR DELETE ON "PrintRun" FOR EACH ROW EXECUTE FUNCTION print_run_append_only();
CREATE TRIGGER "PrintRunItem_append_only" BEFORE UPDATE OR DELETE ON "PrintRunItem" FOR EACH ROW EXECUTE FUNCTION print_run_append_only();
