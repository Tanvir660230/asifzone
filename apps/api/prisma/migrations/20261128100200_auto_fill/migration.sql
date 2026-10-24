-- Smart stock page (docs/STOCK_HUB.md §7): a courier booking whose attar bottles could not be recorded as filled. Additive.
-- CreateTable
CREATE TABLE "StockAutoFillFailure" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "fillKey" TEXT NOT NULL,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAutoFillFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockAutoFillFailure_fillKey_key" ON "StockAutoFillFailure"("fillKey");

-- CreateIndex
CREATE INDEX "StockAutoFillFailure_orderId_idx" ON "StockAutoFillFailure"("orderId");

-- CreateIndex
CREATE INDEX "StockAutoFillFailure_resolvedAt_idx" ON "StockAutoFillFailure"("resolvedAt");

-- AddForeignKey
ALTER TABLE "StockAutoFillFailure" ADD CONSTRAINT "StockAutoFillFailure_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAutoFillFailure" ADD CONSTRAINT "StockAutoFillFailure_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

