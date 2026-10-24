-- Inventory recovery phase 2: a sales policy for fill-to-order products (and a per-variant override). Every existing
-- product keeps TRACKED, so nothing sells differently until the owner chooses a policy.
CREATE TYPE "StockPolicy" AS ENUM ('TRACKED', 'UNLIMITED', 'BACKORDER');
ALTER TABLE "Product" ADD COLUMN "stockPolicy" "StockPolicy" NOT NULL DEFAULT 'TRACKED',
  ADD COLUMN "backorderLimit" INTEGER;
ALTER TABLE "ProductVariant" ADD COLUMN "stockPolicy" "StockPolicy";
