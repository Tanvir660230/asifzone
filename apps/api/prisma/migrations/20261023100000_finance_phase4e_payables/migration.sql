-- Financial Core Phase 4E — supplier invoices, credit notes, accounts payable (docs/FINANCE_PHASE_4E.md)

-- CreateEnum
CREATE TYPE "SupplierInvoiceKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "SupplierInvoiceLineType" AS ENUM ('STOCK', 'RETURN', 'EXPENSE', 'PRODUCTION_COST');

-- AlterTable
ALTER TABLE "FinanceBusiness" ADD COLUMN     "invoicePriceTolerancePct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" "SupplierInvoiceKind" NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierRef" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "notes" TEXT,
    "evidence" TEXT,
    "varianceReason" TEXT,
    "netTotal" DECIMAL(18,2),
    "taxTotal" DECIMAL(18,2),
    "total" DECIMAL(18,2),
    "createdByAdminId" TEXT,
    "postedByAdminId" TEXT,
    "postedAt" TIMESTAMP(3),
    "voidedByAdminId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "lineType" "SupplierInvoiceLineType" NOT NULL,
    "description" TEXT NOT NULL,
    "goodsReceiptLineId" TEXT,
    "purchaseReturnLineId" TEXT,
    "purchaseOrderLineId" TEXT,
    "productionCostEntryId" TEXT,
    "expenseAccountId" TEXT,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "taxCodeId" TEXT,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "recoverableTax" DECIMAL(18,2) NOT NULL,
    "clearedAmount" DECIMAL(18,2),
    "priceDifference" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierInvoice_businessId_status_idx" ON "SupplierInvoice"("businessId", "status");

-- CreateIndex
CREATE INDEX "SupplierInvoice_supplierId_status_idx" ON "SupplierInvoice"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_businessId_number_key" ON "SupplierInvoice"("businessId", "number");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_goodsReceiptLineId_idx" ON "SupplierInvoiceLine"("goodsReceiptLineId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_purchaseReturnLineId_idx" ON "SupplierInvoiceLine"("purchaseReturnLineId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_productionCostEntryId_idx" ON "SupplierInvoiceLine"("productionCostEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoiceLine_invoiceId_lineNo_key" ON "SupplierInvoiceLine"("invoiceId", "lineNo");

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "FinanceBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_goodsReceiptLineId_fkey" FOREIGN KEY ("goodsReceiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_purchaseReturnLineId_fkey" FOREIGN KEY ("purchaseReturnLineId") REFERENCES "PurchaseReturnLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_productionCostEntryId_fkey" FOREIGN KEY ("productionCostEntryId") REFERENCES "ProductionCostEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- P-1 values. Invoice: posted carries its totals; void its time and reason; due on or after the invoice date. Line: net =
--     quantity × unit price; recoverable tax within the tax; each line type names exactly what it bills.
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_values" CHECK (
  length(btrim("supplierRef")) > 0 AND "dueDate" >= "invoiceDate"
  AND (("status" = 'DRAFT') = ("postedAt" IS NULL))
  AND (("status" = 'VOID') = ("voidedAt" IS NOT NULL)) AND ("status" <> 'VOID' OR "voidReason" IS NOT NULL)
  AND ("status" = 'DRAFT' OR ("netTotal" IS NOT NULL AND "taxTotal" IS NOT NULL AND "total" = "netTotal" + "taxTotal" AND "total" >= 0)));
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_values" CHECK (
  "quantity" > 0 AND "unitPrice" >= 0 AND "netAmount" = "quantity" * "unitPrice"
  AND "taxAmount" >= 0 AND "recoverableTax" >= 0 AND "recoverableTax" <= "taxAmount"
  AND (("clearedAmount" IS NULL) = ("priceDifference" IS NULL))
  AND CASE "lineType"
    WHEN 'STOCK' THEN "goodsReceiptLineId" IS NOT NULL AND "variantId" IS NOT NULL AND "purchaseReturnLineId" IS NULL AND "productionCostEntryId" IS NULL AND "expenseAccountId" IS NULL
    WHEN 'RETURN' THEN "purchaseReturnLineId" IS NOT NULL AND "variantId" IS NOT NULL AND "goodsReceiptLineId" IS NULL AND "productionCostEntryId" IS NULL AND "expenseAccountId" IS NULL
    WHEN 'EXPENSE' THEN "expenseAccountId" IS NOT NULL AND "goodsReceiptLineId" IS NULL AND "purchaseReturnLineId" IS NULL AND "productionCostEntryId" IS NULL
    WHEN 'PRODUCTION_COST' THEN "productionCostEntryId" IS NOT NULL AND "quantity" = 1 AND "goodsReceiptLineId" IS NULL AND "purchaseReturnLineId" IS NULL AND "expenseAccountId" IS NULL
  END);

-- P-2 a supplier's bill is entered once: its reference is unique per supplier and kind while live
CREATE UNIQUE INDEX "SupplierInvoice_live_supplier_ref" ON "SupplierInvoice"("supplierId", "kind", lower(btrim("supplierRef"))) WHERE "status" <> 'VOID';

-- P-3 lifecycle: DRAFT → POSTED → VOID; a posted invoice is immutable (a void records only its own fields); only drafts are
--     deleted; lines change only while their invoice is a draft; goods / returns / production costs only on the right kind
CREATE OR REPLACE FUNCTION ap_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a posted supplier invoice is never deleted (void it)' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a supplier invoice starts as a draft' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'VOID' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a void supplier invoice is final' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (('DRAFT', 'POSTED'), ('POSTED', 'VOID'))) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a supplier invoice can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'POSTED' AND (NEW."businessId", NEW."brandId", NEW."supplierId", NEW.kind, NEW.number, NEW."supplierRef", NEW."invoiceDate", NEW."dueDate", NEW.currency, NEW."varianceReason", NEW."netTotal", NEW."taxTotal", NEW.total, NEW."postedAt", NEW."postedByAdminId")
     IS DISTINCT FROM (OLD."businessId", OLD."brandId", OLD."supplierId", OLD.kind, OLD.number, OLD."supplierRef", OLD."invoiceDate", OLD."dueDate", OLD.currency, OLD."varianceReason", OLD."netTotal", OLD."taxTotal", OLD.total, OLD."postedAt", OLD."postedByAdminId") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a posted supplier invoice is immutable (void it)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SupplierInvoice_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SupplierInvoice" FOR EACH ROW EXECUTE FUNCTION ap_invoice_guard();

CREATE OR REPLACE FUNCTION ap_invoice_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; k text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status, kind INTO st, k FROM "SupplierInvoice" WHERE id = COALESCE(NEW."invoiceId", OLD."invoiceId");
  IF st = 'DRAFT' AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF st = 'DRAFT' THEN
    IF (NEW."lineType" IN ('STOCK', 'PRODUCTION_COST') AND k <> 'INVOICE') OR (NEW."lineType" = 'RETURN' AND k <> 'CREDIT_NOTE') THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: a % line doesn''t belong on a %', NEW."lineType", lower(replace(k, '_', ' ')) USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- posting records what each line cleared (once)
  IF st = 'DRAFT' OR (TG_OP = 'UPDATE' AND OLD."clearedAmount" IS NULL
     AND (NEW."invoiceId", NEW."lineNo", NEW."lineType", NEW."goodsReceiptLineId", NEW."purchaseReturnLineId", NEW."productionCostEntryId", NEW."expenseAccountId", NEW."variantId", NEW.quantity, NEW."unitPrice", NEW."taxCodeId", NEW."netAmount", NEW."taxAmount", NEW."recoverableTax")
         IS NOT DISTINCT FROM (OLD."invoiceId", OLD."lineNo", OLD."lineType", OLD."goodsReceiptLineId", OLD."purchaseReturnLineId", OLD."productionCostEntryId", OLD."expenseAccountId", OLD."variantId", OLD.quantity, OLD."unitPrice", OLD."taxCodeId", OLD."netAmount", OLD."taxAmount", OLD."recoverableTax")) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: a posted supplier invoice''s lines are immutable' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "SupplierInvoiceLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SupplierInvoiceLine" FOR EACH ROW EXECUTE FUNCTION ap_invoice_line_guard();

-- P-4 audit at commit, no TRUNCATE
CREATE CONSTRAINT TRIGGER "SupplierInvoice_audit" AFTER INSERT OR UPDATE OR DELETE ON "SupplierInvoice"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('SupplierInvoice');
CREATE TRIGGER "SupplierInvoice_no_truncate" BEFORE TRUNCATE ON "SupplierInvoice" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "SupplierInvoiceLine_no_truncate" BEFORE TRUNCATE ON "SupplierInvoiceLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
