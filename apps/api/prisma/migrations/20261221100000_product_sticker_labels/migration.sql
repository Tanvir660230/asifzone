-- Product stickers: label name/tag per product, store label tagline, supplier lists (label batches).
ALTER TABLE "Product" ADD COLUMN "labelName" VARCHAR(60), ADD COLUMN "labelTag" VARCHAR(30);
ALTER TABLE "StoreSetting" ADD COLUMN "labelTagline" VARCHAR(40);

CREATE TABLE "LabelBatch" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "supplier" VARCHAR(80),
    "notes" VARCHAR(500),
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LabelBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LabelBatch_createdAt_idx" ON "LabelBatch"("createdAt");

CREATE TABLE "LabelBatchLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "qtyOrdered" INTEGER NOT NULL DEFAULT 0,
    "qtyReceived" INTEGER,
    CONSTRAINT "LabelBatchLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LabelBatchLine_batchId_variantId_key" ON "LabelBatchLine"("batchId", "variantId");
CREATE INDEX "LabelBatchLine_variantId_idx" ON "LabelBatchLine"("variantId");
ALTER TABLE "LabelBatchLine" ADD CONSTRAINT "LabelBatchLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LabelBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LabelBatchLine" ADD CONSTRAINT "LabelBatchLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
