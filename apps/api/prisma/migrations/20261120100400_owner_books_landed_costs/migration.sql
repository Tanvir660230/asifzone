-- Owner's books §7.1 (docs/FINANCE_OWNER_BOOKS.md): landed costs — transport, labour or customs added to the goods they brought in.

-- CreateEnum
CREATE TYPE "LandedCostMethod" AS ENUM ('QUANTITY', 'VALUE');

-- CreateTable
CREATE TABLE "LandedCost" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "costDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "payee" TEXT,
    "method" "LandedCostMethod" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "goodsReceiptIds" TEXT[],
    "allocations" JSONB NOT NULL,
    "movementId" TEXT NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandedCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LandedCost_movementId_key" ON "LandedCost"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "LandedCost_businessId_number_key" ON "LandedCost"("businessId", "number");

-- AddForeignKey
ALTER TABLE "LandedCost" ADD CONSTRAINT "LandedCost_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandedCost" ADD CONSTRAINT "LandedCost_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- L-1 values; a landed cost is history (never changed or deleted)
ALTER TABLE "LandedCost" ADD CONSTRAINT "LandedCost_values" CHECK ("amount" > 0 AND length(btrim("description")) > 0 AND cardinality("goodsReceiptIds") > 0);
CREATE OR REPLACE FUNCTION finance_landed_cost_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance_purge_allowed() THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'FINANCE_INVARIANT: a landed cost is history' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "LandedCost_guard" BEFORE UPDATE OR DELETE ON "LandedCost" FOR EACH ROW EXECUTE FUNCTION finance_landed_cost_guard();
CREATE TRIGGER "LandedCost_no_truncate" BEFORE TRUNCATE ON "LandedCost" FOR EACH STATEMENT EXECUTE FUNCTION finance_truncate_guard();
