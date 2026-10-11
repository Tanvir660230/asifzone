-- Manufacturing M1 — foundation (docs/MANUFACTURING.md): material products, versioned bills of materials, production
-- orders planned per variant with material requirements, configurable production cost categories and planned costs.
--   M-1 a MATERIAL product is never sold (never active / published) and has a stock unit;
--   M-2 positive quantities, wastage below 100%, custody issued >= returned + consumed + scrapped (I-6);
--   M-3 BOM versions DRAFT -> APPROVED (frozen) -> ARCHIVED;  M-4 production-order lifecycle;
--   M-5 a plan changes only in DRAFT;  M-6 cost categories are never deleted;  M-7 audit at commit, no TRUNCATE.

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('FINISHED', 'MATERIAL');

-- CreateEnum
CREATE TYPE "BomStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MaterialSupplier" AS ENUM ('BUSINESS', 'PRODUCER');

-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'IN_PRODUCTION', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionCostGroup" AS ENUM ('MATERIAL', 'LABOUR', 'EXTERNAL_SERVICE', 'OVERHEAD', 'OTHER');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "kind" "ProductKind" NOT NULL DEFAULT 'FINISHED',
ADD COLUMN     "stockUnit" TEXT;

-- CreateTable
CREATE TABLE "BillOfMaterials" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "BomStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillOfMaterials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillOfMaterialsLine" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "materialVariantId" TEXT NOT NULL,
    "finishedVariantId" TEXT,
    "qtyPerUnit" DECIMAL(18,6) NOT NULL,
    "wastagePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "suppliedBy" "MaterialSupplier" NOT NULL DEFAULT 'BUSINESS',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillOfMaterialsLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "productId" TEXT NOT NULL,
    "bomId" TEXT,
    "producerSupplierId" TEXT,
    "orderDate" DATE NOT NULL,
    "expectedDate" DATE,
    "terms" TEXT,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrderLine" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "variantId" TEXT NOT NULL,
    "plannedQty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionMaterialLine" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "materialVariantId" TEXT NOT NULL,
    "suppliedBy" "MaterialSupplier" NOT NULL,
    "bomLineId" TEXT,
    "qtyPerUnit" DECIMAL(18,6),
    "wastagePct" DECIMAL(5,2),
    "plannedQty" INTEGER NOT NULL,
    "plannedUnitCost" DECIMAL(18,6),
    "issuedQty" INTEGER NOT NULL DEFAULT 0,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "consumedQty" INTEGER NOT NULL DEFAULT 0,
    "scrappedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionMaterialLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionCostCategory" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "ProductionCostGroup" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionCostCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionPlannedCost" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "basis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionPlannedCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillOfMaterials_businessId_status_idx" ON "BillOfMaterials"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BillOfMaterials_productId_version_key" ON "BillOfMaterials"("productId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BillOfMaterialsLine_bomId_lineNo_key" ON "BillOfMaterialsLine"("bomId", "lineNo");

-- CreateIndex
CREATE INDEX "ProductionOrder_businessId_status_idx" ON "ProductionOrder"("businessId", "status");

-- CreateIndex
CREATE INDEX "ProductionOrder_productId_idx" ON "ProductionOrder"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_businessId_number_key" ON "ProductionOrder"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrderLine_productionOrderId_lineNo_key" ON "ProductionOrderLine"("productionOrderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrderLine_productionOrderId_variantId_key" ON "ProductionOrderLine"("productionOrderId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionMaterialLine_productionOrderId_lineNo_key" ON "ProductionMaterialLine"("productionOrderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionCostCategory_businessId_code_key" ON "ProductionCostCategory"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionPlannedCost_productionOrderId_categoryId_key" ON "ProductionPlannedCost"("productionOrderId", "categoryId");

-- AddForeignKey
ALTER TABLE "BillOfMaterials" ADD CONSTRAINT "BillOfMaterials_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfMaterials" ADD CONSTRAINT "BillOfMaterials_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfMaterialsLine" ADD CONSTRAINT "BillOfMaterialsLine_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BillOfMaterials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfMaterialsLine" ADD CONSTRAINT "BillOfMaterialsLine_materialVariantId_fkey" FOREIGN KEY ("materialVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfMaterialsLine" ADD CONSTRAINT "BillOfMaterialsLine_finishedVariantId_fkey" FOREIGN KEY ("finishedVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "FinanceBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BillOfMaterials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_producerSupplierId_fkey" FOREIGN KEY ("producerSupplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionMaterialLine" ADD CONSTRAINT "ProductionMaterialLine_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionMaterialLine" ADD CONSTRAINT "ProductionMaterialLine_materialVariantId_fkey" FOREIGN KEY ("materialVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCostCategory" ADD CONSTRAINT "ProductionCostCategory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlannedCost" ADD CONSTRAINT "ProductionPlannedCost_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlannedCost" ADD CONSTRAINT "ProductionPlannedCost_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductionCostCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- M-1 a material is never sold: never active, never published (the one purchasability rule reads isActive)
ALTER TABLE "Product" ADD CONSTRAINT "Product_material_never_sold" CHECK ("kind" <> 'MATERIAL' OR ("isActive" = false AND "status" <> 'PUBLISHED'));
ALTER TABLE "Product" ADD CONSTRAINT "Product_material_unit" CHECK ("kind" <> 'MATERIAL' OR length(btrim(coalesce("stockUnit", ''))) > 0);

-- M-2 values
ALTER TABLE "BillOfMaterialsLine" ADD CONSTRAINT "BillOfMaterialsLine_values" CHECK ("qtyPerUnit" > 0 AND "wastagePct" >= 0 AND "wastagePct" < 100);
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_values" CHECK ("plannedQty" > 0);
ALTER TABLE "ProductionMaterialLine" ADD CONSTRAINT "ProductionMaterialLine_values" CHECK (
  "plannedQty" >= 0 AND ("qtyPerUnit" IS NULL OR "qtyPerUnit" > 0) AND ("wastagePct" IS NULL OR ("wastagePct" >= 0 AND "wastagePct" < 100))
  AND ("plannedUnitCost" IS NULL OR "plannedUnitCost" >= 0)
  AND "issuedQty" >= 0 AND "returnedQty" >= 0 AND "consumedQty" >= 0 AND "scrappedQty" >= 0
  -- I-6 custody: what was issued is consumed, returned, scrapped or still at the producer — never less than accounted for
  AND "issuedQty" >= "returnedQty" + "consumedQty" + "scrappedQty"
  AND ("suppliedBy" = 'BUSINESS' OR ("issuedQty" = 0 AND "returnedQty" = 0 AND "scrappedQty" = 0)));
ALTER TABLE "ProductionPlannedCost" ADD CONSTRAINT "ProductionPlannedCost_values" CHECK ("amount" >= 0);

-- M-3 BOM versions: DRAFT → APPROVED → ARCHIVED; an approved version is frozen; only drafts are deleted
CREATE OR REPLACE FUNCTION mfg_bom_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: only a draft bill of materials can be deleted (archive it)' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'ARCHIVED' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: an archived bill of materials is final' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (('DRAFT', 'APPROVED'), ('APPROVED', 'ARCHIVED'))) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a bill of materials can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW."productId", NEW.version) IS DISTINCT FROM (OLD."productId", OLD.version) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: an approved bill of materials keeps its product and version' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "BillOfMaterials_guard" BEFORE UPDATE OR DELETE ON "BillOfMaterials" FOR EACH ROW EXECUTE FUNCTION mfg_bom_guard();

CREATE OR REPLACE FUNCTION mfg_bom_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO s FROM "BillOfMaterials" WHERE id = COALESCE(NEW."bomId", OLD."bomId");
  IF s <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: an approved bill of materials is frozen — make a new version' USING ERRCODE = 'check_violation'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "BillOfMaterialsLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "BillOfMaterialsLine" FOR EACH ROW EXECUTE FUNCTION mfg_bom_line_guard();

-- M-4 production orders
CREATE OR REPLACE FUNCTION mfg_production_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: only a draft production order can be deleted (cancel it)' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('CLOSED', 'CANCELLED') THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a % production order is final', lower(OLD.status::text) USING ERRCODE = 'check_violation'; END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (
      ('DRAFT', 'APPROVED'), ('DRAFT', 'CANCELLED'),
      ('APPROVED', 'DRAFT'), ('APPROVED', 'IN_PRODUCTION'), ('APPROVED', 'PARTIALLY_RECEIVED'), ('APPROVED', 'RECEIVED'), ('APPROVED', 'CANCELLED'),
      ('IN_PRODUCTION', 'PARTIALLY_RECEIVED'), ('IN_PRODUCTION', 'RECEIVED'), ('IN_PRODUCTION', 'CLOSED'),
      ('PARTIALLY_RECEIVED', 'RECEIVED'), ('PARTIALLY_RECEIVED', 'IN_PRODUCTION'), ('PARTIALLY_RECEIVED', 'CLOSED'),
      ('RECEIVED', 'PARTIALLY_RECEIVED'), ('RECEIVED', 'CLOSED'))) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: a production order can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('DRAFT', 'CANCELLED') AND OLD.status <> 'DRAFT'
     AND EXISTS (SELECT 1 FROM "ProductionMaterialLine" WHERE "productionOrderId" = NEW.id AND "issuedQty" > 0) THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: materials were issued to this production order — it can''t go back to draft or be cancelled' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW."businessId", NEW.number, NEW."productId", NEW."bomId", NEW."producerSupplierId")
     IS DISTINCT FROM (OLD."businessId", OLD.number, OLD."productId", OLD."bomId", OLD."producerSupplierId") THEN
    RAISE EXCEPTION 'FINANCE_INVARIANT: an approved production order keeps its product, BOM and producer' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionOrder_guard" BEFORE UPDATE OR DELETE ON "ProductionOrder" FOR EACH ROW EXECUTE FUNCTION mfg_production_order_guard();

-- M-5 plan lines (variants, materials, planned costs) change only in DRAFT; a material line's custody columns change only
--     while the order is in production (M2), never its plan
CREATE OR REPLACE FUNCTION mfg_production_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO s FROM "ProductionOrder" WHERE id = COALESCE(NEW."productionOrderId", OLD."productionOrderId");
  IF s = 'DRAFT' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'ProductionMaterialLine' AND TG_OP = 'UPDATE' AND s IN ('APPROVED', 'IN_PRODUCTION', 'PARTIALLY_RECEIVED', 'RECEIVED')
     AND (NEW."productionOrderId", NEW."lineNo", NEW."materialVariantId", NEW."suppliedBy", NEW."bomLineId", NEW."qtyPerUnit", NEW."wastagePct", NEW."plannedQty", NEW."plannedUnitCost")
         IS NOT DISTINCT FROM (OLD."productionOrderId", OLD."lineNo", OLD."materialVariantId", OLD."suppliedBy", OLD."bomLineId", OLD."qtyPerUnit", OLD."wastagePct", OLD."plannedQty", OLD."plannedUnitCost") THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'ProductionMaterialLine' AND TG_OP = 'UPDATE' AND s = 'APPROVED' AND OLD."issuedQty" = 0 AND NEW."issuedQty" = 0
     AND (NEW."productionOrderId", NEW."lineNo", NEW."materialVariantId", NEW."suppliedBy", NEW."bomLineId", NEW."qtyPerUnit", NEW."wastagePct", NEW."plannedQty")
         IS NOT DISTINCT FROM (OLD."productionOrderId", OLD."lineNo", OLD."materialVariantId", OLD."suppliedBy", OLD."bomLineId", OLD."qtyPerUnit", OLD."wastagePct", OLD."plannedQty") THEN
    RETURN NEW; -- approval snapshots the planned unit cost
  END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: an approved production order''s plan is frozen (send it back to draft while nothing is issued)' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "ProductionOrderLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProductionOrderLine" FOR EACH ROW EXECUTE FUNCTION mfg_production_plan_guard();
CREATE TRIGGER "ProductionMaterialLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProductionMaterialLine" FOR EACH ROW EXECUTE FUNCTION mfg_production_plan_guard();
CREATE TRIGGER "ProductionPlannedCost_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProductionPlannedCost" FOR EACH ROW EXECUTE FUNCTION mfg_production_plan_guard();

-- M-6 cost categories are never deleted (deactivate); their code never changes
CREATE OR REPLACE FUNCTION mfg_cost_category_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'FINANCE_INVARIANT: cost categories are never deleted (deactivate them)' USING ERRCODE = 'check_violation'; END IF;
  IF (NEW."businessId", NEW.code) IS DISTINCT FROM (OLD."businessId", OLD.code) THEN RAISE EXCEPTION 'FINANCE_INVARIANT: a cost category''s code never changes' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionCostCategory_guard" BEFORE UPDATE OR DELETE ON "ProductionCostCategory" FOR EACH ROW EXECUTE FUNCTION mfg_cost_category_guard();

-- M-7 audit at commit, no TRUNCATE
CREATE CONSTRAINT TRIGGER "BillOfMaterials_audit" AFTER INSERT OR UPDATE OR DELETE ON "BillOfMaterials"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('BillOfMaterials');
CREATE CONSTRAINT TRIGGER "ProductionOrder_audit" AFTER INSERT OR UPDATE OR DELETE ON "ProductionOrder"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('ProductionOrder');
CREATE CONSTRAINT TRIGGER "ProductionCostCategory_audit" AFTER INSERT OR UPDATE OR DELETE ON "ProductionCostCategory"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_require_audit('ProductionCostCategory');
CREATE TRIGGER "BillOfMaterials_no_truncate" BEFORE TRUNCATE ON "BillOfMaterials" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "BillOfMaterialsLine_no_truncate" BEFORE TRUNCATE ON "BillOfMaterialsLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "ProductionOrder_no_truncate" BEFORE TRUNCATE ON "ProductionOrder" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "ProductionOrderLine_no_truncate" BEFORE TRUNCATE ON "ProductionOrderLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "ProductionMaterialLine_no_truncate" BEFORE TRUNCATE ON "ProductionMaterialLine" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "ProductionCostCategory_no_truncate" BEFORE TRUNCATE ON "ProductionCostCategory" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
CREATE TRIGGER "ProductionPlannedCost_no_truncate" BEFORE TRUNCATE ON "ProductionPlannedCost" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
