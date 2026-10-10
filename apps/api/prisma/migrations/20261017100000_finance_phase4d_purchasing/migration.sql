-- Financial Core Phase 4D — purchasing documents (docs/FINANCE_PHASE_4D.md): purchase orders, goods receipts, supplier
-- returns. A purchase order posts nothing; a goods receipt moves stock (inventory.service) and value (costing.service) and
-- posts Dr inventory / Cr GRNI through the event inbox; a shipped return posts Dr GRNI (returns) / Cr inventory.
--
--   P-1 lifecycles are enforced here (legal transitions only; posted / shipped documents immutable; only drafts deleted);
--   P-2 lines change only while their document is a draft — except the posting's own columns;
--   P-3 an order line's received / returned quantities are DERIVED: maintained by these triggers from receipts posted or
--       reversed and returns shipped, never written by application code;
--   P-4 value = accepted × unit cost; STOCK lines name a variant, NON_STOCK lines an expense account; positive quantities;
--   P-5 a posted receipt without an order carries its reason and approver;
--   P-6 audit entry at commit (F-6) and no TRUNCATE (F-10).

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseLineType" AS ENUM ('STOCK', 'NON_STOCK');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PurchaseReturnStatus" AS ENUM ('DRAFT', 'APPROVED', 'SHIPPED', 'CANCELLED');

-- AlterTable
ALTER TABLE "FinanceBusiness" ADD COLUMN     "overReceiptTolerancePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "purchaseApprovalThreshold" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" DATE NOT NULL,
    "expectedDate" DATE,
    "currency" VARCHAR(3) NOT NULL,
    "deliveryTerms" TEXT,
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdByAdminId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "lineType" "PurchaseLineType" NOT NULL,
    "variantId" TEXT,
    "sku" TEXT,
    "description" TEXT NOT NULL,
    "expenseAccountId" TEXT,
    "qtyOrdered" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "taxCodeId" TEXT,
    "qtyReceived" INTEGER NOT NULL DEFAULT 0,
    "qtyReturned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "number" INTEGER NOT NULL,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "receiptDate" DATE NOT NULL,
    "supplierRef" TEXT,
    "notes" TEXT,
    "directReason" TEXT,
    "directApprovedByAdminId" TEXT,
    "evidence" TEXT,
    "overReceiptReason" TEXT,
    "createdByAdminId" TEXT,
    "postedByAdminId" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversedByAdminId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "purchaseOrderLineId" TEXT,
    "variantId" TEXT NOT NULL,
    "qtyAccepted" INTEGER NOT NULL,
    "qtyRejected" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,2) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "stockMovementId" TEXT,
    "reversalMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturn" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "PurchaseReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "returnDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "shippedByAdminId" TEXT,
    "shippedAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturnLine" (
    "id" TEXT NOT NULL,
    "purchaseReturnId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "goodsReceiptLineId" TEXT,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "value" DECIMAL(18,2),
    "stockMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrder_businessId_status_idx" ON "PurchaseOrder"("businessId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_status_idx" ON "PurchaseOrder"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_businessId_number_key" ON "PurchaseOrder"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_lineNo_key" ON "PurchaseOrderLine"("purchaseOrderId", "lineNo");

-- CreateIndex
CREATE INDEX "GoodsReceipt_businessId_status_idx" ON "GoodsReceipt"("businessId", "status");

-- CreateIndex
CREATE INDEX "GoodsReceipt_purchaseOrderId_idx" ON "GoodsReceipt"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_businessId_number_key" ON "GoodsReceipt"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptLine_stockMovementId_key" ON "GoodsReceiptLine"("stockMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptLine_reversalMovementId_key" ON "GoodsReceiptLine"("reversalMovementId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_variantId_idx" ON "GoodsReceiptLine"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptLine_goodsReceiptId_lineNo_key" ON "GoodsReceiptLine"("goodsReceiptId", "lineNo");

-- CreateIndex
CREATE INDEX "PurchaseReturn_businessId_status_idx" ON "PurchaseReturn"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturn_businessId_number_key" ON "PurchaseReturn"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturnLine_stockMovementId_key" ON "PurchaseReturnLine"("stockMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturnLine_purchaseReturnId_lineNo_key" ON "PurchaseReturnLine"("purchaseReturnId", "lineNo");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "FinanceBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "FinanceBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "FinanceBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_goodsReceiptLineId_fkey" FOREIGN KEY ("goodsReceiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- P-4
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_values" CHECK (
  "qtyOrdered" > 0 AND "unitPrice" >= 0 AND "qtyReceived" >= 0 AND "qtyReturned" >= 0
  AND (("lineType" = 'STOCK' AND "variantId" IS NOT NULL AND "expenseAccountId" IS NULL)
    OR ("lineType" = 'NON_STOCK' AND "variantId" IS NULL AND "expenseAccountId" IS NOT NULL)));
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_values" CHECK (
  "qtyAccepted" >= 0 AND "qtyRejected" >= 0 AND "qtyAccepted" + "qtyRejected" > 0 AND "unitCost" >= 0 AND "value" = "qtyAccepted" * "unitCost");
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_values" CHECK ("quantity" > 0 AND ("value" IS NULL OR "value" >= 0));
ALTER TABLE "FinanceBusiness" ADD CONSTRAINT "FinanceBusiness_purchasing_settings" CHECK (
  ("purchaseApprovalThreshold" IS NULL OR "purchaseApprovalThreshold" >= 0) AND "overReceiptTolerancePct" BETWEEN 0 AND 100);
-- P-5
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_direct_approved" CHECK (
  "status" = 'DRAFT' OR "purchaseOrderId" IS NOT NULL OR (length(btrim(coalesce("directReason", ''))) > 0 AND "directApprovedByAdminId" IS NOT NULL));
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_status_fields" CHECK (
  ("status" = 'DRAFT') = ("postedAt" IS NULL) AND ("status" = 'REVERSED') = ("reversedAt" IS NOT NULL));

-- P-1 purchase orders
CREATE OR REPLACE FUNCTION finance_purchase_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: only a draft purchase order can be deleted (cancel it instead)' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a % purchase order is final', lower(OLD.status::text) USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (
      ('DRAFT', 'SUBMITTED'), ('DRAFT', 'CANCELLED'),
      ('SUBMITTED', 'APPROVED'), ('SUBMITTED', 'DRAFT'), ('SUBMITTED', 'CANCELLED'),
      ('APPROVED', 'PARTIALLY_RECEIVED'), ('APPROVED', 'RECEIVED'), ('APPROVED', 'CLOSED'), ('APPROVED', 'CANCELLED'),
      ('PARTIALLY_RECEIVED', 'RECEIVED'), ('PARTIALLY_RECEIVED', 'CLOSED'), ('PARTIALLY_RECEIVED', 'APPROVED'),
      ('RECEIVED', 'PARTIALLY_RECEIVED'), ('RECEIVED', 'APPROVED'), ('RECEIVED', 'CLOSED'))) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a purchase order can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'CANCELLED' AND EXISTS (SELECT 1 FROM "PurchaseOrderLine" WHERE "purchaseOrderId" = NEW.id AND "qtyReceived" > 0) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a purchase order with receipts can''t be cancelled (close it)' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."businessId", NEW."supplierId", NEW.number) IS DISTINCT FROM (OLD."businessId", OLD."supplierId", OLD.number) AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a submitted purchase order keeps its supplier and number' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PurchaseOrder_guard" BEFORE UPDATE OR DELETE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION finance_purchase_order_guard();

-- P-2 / P-3 order lines: editable in DRAFT only; the derived quantities change only through the triggers below
CREATE OR REPLACE FUNCTION finance_purchase_order_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO s FROM "PurchaseOrder" WHERE id = COALESCE(NEW."purchaseOrderId", OLD."purchaseOrderId");
  IF TG_OP = 'UPDATE' AND (NEW."qtyReceived", NEW."qtyReturned") IS DISTINCT FROM (OLD."qtyReceived", OLD."qtyReturned") THEN
    IF coalesce(current_setting('finance.derive_po_qty', true), '') <> 'on' THEN
      RAISE EXCEPTION 'FINANCE_INVARIANT: received / returned quantities are derived from receipts and returns' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW."purchaseOrderId", NEW."lineNo", NEW."lineType", NEW."variantId", NEW.sku, NEW.description, NEW."expenseAccountId", NEW."qtyOrdered", NEW."unitPrice", NEW."taxCodeId")
       IS NOT DISTINCT FROM (OLD."purchaseOrderId", OLD."lineNo", OLD."lineType", OLD."variantId", OLD.sku, OLD.description, OLD."expenseAccountId", OLD."qtyOrdered", OLD."unitPrice", OLD."taxCodeId") THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND (NEW."qtyReceived" <> 0 OR NEW."qtyReturned" <> 0) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a new order line has nothing received' USING ERRCODE = 'check_violation';
  END IF;
  IF s <> 'DRAFT' THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a submitted purchase order''s lines are frozen (revise it)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "PurchaseOrderLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseOrderLine" FOR EACH ROW EXECUTE FUNCTION finance_purchase_order_line_guard();

-- P-1 goods receipts
CREATE OR REPLACE FUNCTION finance_goods_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a posted goods receipt is never deleted (reverse it)' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'REVERSED' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a reversed goods receipt is final' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (('DRAFT', 'POSTED'), ('POSTED', 'REVERSED'))) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a goods receipt can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'POSTED' AND (NEW."businessId", NEW."brandId", NEW."supplierId", NEW."purchaseOrderId", NEW.number, NEW."receiptDate", NEW."supplierRef", NEW."directReason", NEW."directApprovedByAdminId", NEW."overReceiptReason", NEW."postedAt")
      IS DISTINCT FROM (OLD."businessId", OLD."brandId", OLD."supplierId", OLD."purchaseOrderId", OLD.number, OLD."receiptDate", OLD."supplierRef", OLD."directReason", OLD."directApprovedByAdminId", OLD."overReceiptReason", OLD."postedAt") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a posted goods receipt is immutable (reverse it)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "GoodsReceipt_guard" BEFORE UPDATE OR DELETE ON "GoodsReceipt" FOR EACH ROW EXECUTE FUNCTION finance_goods_receipt_guard();

CREATE OR REPLACE FUNCTION finance_goods_receipt_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO s FROM "GoodsReceipt" WHERE id = COALESCE(NEW."goodsReceiptId", OLD."goodsReceiptId");
  IF s = 'DRAFT' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF s = 'POSTED' AND TG_OP = 'UPDATE' AND OLD."reversalMovementId" IS NULL
     AND (NEW."goodsReceiptId", NEW."lineNo", NEW."purchaseOrderLineId", NEW."variantId", NEW."qtyAccepted", NEW."qtyRejected", NEW."unitCost", NEW.value, NEW."stockMovementId")
         IS NOT DISTINCT FROM (OLD."goodsReceiptId", OLD."lineNo", OLD."purchaseOrderLineId", OLD."variantId", OLD."qtyAccepted", OLD."qtyRejected", OLD."unitCost", OLD.value, OLD."stockMovementId") THEN
    RETURN NEW; -- the reversal records its stock movement
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: a posted goods receipt''s lines are immutable' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "GoodsReceiptLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "GoodsReceiptLine" FOR EACH ROW EXECUTE FUNCTION finance_goods_receipt_line_guard();

-- P-3 received quantities follow the receipt's status
CREATE OR REPLACE FUNCTION finance_goods_receipt_derive() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sign int;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NULL; END IF;
  sign := CASE WHEN (OLD.status, NEW.status) = ('DRAFT', 'POSTED') THEN 1 WHEN (OLD.status, NEW.status) = ('POSTED', 'REVERSED') THEN -1 ELSE 0 END;
  IF sign = 0 THEN RETURN NULL; END IF;
  PERFORM set_config('finance.derive_po_qty', 'on', true);
  UPDATE "PurchaseOrderLine" pol SET "qtyReceived" = pol."qtyReceived" + sign * x.qty, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
  FROM (SELECT "purchaseOrderLineId" AS id, SUM("qtyAccepted")::int AS qty FROM "GoodsReceiptLine" WHERE "goodsReceiptId" = NEW.id AND "purchaseOrderLineId" IS NOT NULL GROUP BY 1) x
  WHERE pol.id = x.id;
  PERFORM set_config('finance.derive_po_qty', '', true);
  RETURN NULL;
END $$;
CREATE TRIGGER "GoodsReceipt_derive" AFTER UPDATE OF status ON "GoodsReceipt" FOR EACH ROW EXECUTE FUNCTION finance_goods_receipt_derive();

-- P-1 supplier returns
CREATE OR REPLACE FUNCTION finance_purchase_return_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: only a draft supplier return can be deleted' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('SHIPPED', 'CANCELLED') THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a % supplier return is final', lower(OLD.status::text) USING ERRCODE = 'check_violation'; END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (('DRAFT', 'APPROVED'), ('DRAFT', 'CANCELLED'), ('APPROVED', 'DRAFT'), ('APPROVED', 'SHIPPED'), ('APPROVED', 'CANCELLED'))) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a supplier return can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PurchaseReturn_guard" BEFORE UPDATE OR DELETE ON "PurchaseReturn" FOR EACH ROW EXECUTE FUNCTION finance_purchase_return_guard();

CREATE OR REPLACE FUNCTION finance_purchase_return_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO s FROM "PurchaseReturn" WHERE id = COALESCE(NEW."purchaseReturnId", OLD."purchaseReturnId");
  IF s = 'DRAFT' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF s = 'APPROVED' AND TG_OP = 'UPDATE' AND OLD."stockMovementId" IS NULL
     AND (NEW."purchaseReturnId", NEW."lineNo", NEW."goodsReceiptLineId", NEW."variantId", NEW.quantity)
         IS NOT DISTINCT FROM (OLD."purchaseReturnId", OLD."lineNo", OLD."goodsReceiptLineId", OLD."variantId", OLD.quantity) THEN
    RETURN NEW; -- shipping records the movement and value
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: an approved or shipped supplier return''s lines are frozen' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "PurchaseReturnLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseReturnLine" FOR EACH ROW EXECUTE FUNCTION finance_purchase_return_line_guard();

-- P-3 returned quantities follow shipping
CREATE OR REPLACE FUNCTION finance_purchase_return_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD.status = 'APPROVED' AND NEW.status = 'SHIPPED') THEN RETURN NULL; END IF;
  PERFORM set_config('finance.derive_po_qty', 'on', true);
  UPDATE "PurchaseOrderLine" pol SET "qtyReturned" = pol."qtyReturned" + x.qty, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
  FROM (SELECT grl."purchaseOrderLineId" AS id, SUM(prl.quantity)::int AS qty
        FROM "PurchaseReturnLine" prl JOIN "GoodsReceiptLine" grl ON grl.id = prl."goodsReceiptLineId"
        WHERE prl."purchaseReturnId" = NEW.id AND grl."purchaseOrderLineId" IS NOT NULL GROUP BY 1) x
  WHERE pol.id = x.id;
  PERFORM set_config('finance.derive_po_qty', '', true);
  RETURN NULL;
END $$;
CREATE TRIGGER "PurchaseReturn_derive" AFTER UPDATE OF status ON "PurchaseReturn" FOR EACH ROW EXECUTE FUNCTION finance_purchase_return_derive();

-- P-6
CREATE CONSTRAINT TRIGGER "PurchaseOrder_audit" AFTER INSERT OR UPDATE OR DELETE ON "PurchaseOrder"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('PurchaseOrder');
CREATE CONSTRAINT TRIGGER "GoodsReceipt_audit" AFTER INSERT OR UPDATE OR DELETE ON "GoodsReceipt"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('GoodsReceipt');
CREATE CONSTRAINT TRIGGER "PurchaseReturn_audit" AFTER INSERT OR UPDATE OR DELETE ON "PurchaseReturn"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('PurchaseReturn');
CREATE TRIGGER "PurchaseOrder_no_truncate" BEFORE TRUNCATE ON "PurchaseOrder" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "PurchaseOrderLine_no_truncate" BEFORE TRUNCATE ON "PurchaseOrderLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "GoodsReceipt_no_truncate" BEFORE TRUNCATE ON "GoodsReceipt" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "GoodsReceiptLine_no_truncate" BEFORE TRUNCATE ON "GoodsReceiptLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "PurchaseReturn_no_truncate" BEFORE TRUNCATE ON "PurchaseReturn" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "PurchaseReturnLine_no_truncate" BEFORE TRUNCATE ON "PurchaseReturnLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
