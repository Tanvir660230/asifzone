-- Stock hub review fixes (docs/STOCK_HUB.md §5).
-- 1. A lease token: a request that outlived its lease can't save over the retry that took the entry over.
ALTER TABLE "StockHubEntry" ADD COLUMN "leaseToken" TEXT;

-- 2. One live receipt and one live bill per Bought step, whatever the timing: the evidence stamp
--    `stock-purchase:<key>:receipt|invoice` is unique among receipts not reversed and bills not voided. Evidence is free
--    text elsewhere, so the guarantee covers only the stock hub's own stamps.
CREATE UNIQUE INDEX "GoodsReceipt_stock_purchase_evidence_key" ON "GoodsReceipt"("businessId", "evidence")
  WHERE "status" <> 'REVERSED' AND "evidence" LIKE 'stock-purchase:%';
CREATE UNIQUE INDEX "SupplierInvoice_stock_purchase_evidence_key" ON "SupplierInvoice"("businessId", "evidence")
  WHERE "status" <> 'VOID' AND "evidence" LIKE 'stock-purchase:%';

-- 3. A count line from the stock hub is recorded once.
ALTER TABLE "StockCount" ADD COLUMN "sourceId" TEXT;
CREATE UNIQUE INDEX "StockCount_sourceId_key" ON "StockCount"("sourceId");
