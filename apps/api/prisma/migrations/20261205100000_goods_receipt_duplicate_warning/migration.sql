-- Blueprint P0.3: duplicate-purchase warning stored on the receipt (additive, nullable).
ALTER TABLE "GoodsReceipt" ADD COLUMN "duplicateWarning" JSONB;
ALTER TABLE "GoodsReceipt" ADD COLUMN "duplicateReason" TEXT;
