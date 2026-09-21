-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('CLOTHING', 'FRAGRANCE', 'ACCESSORY', 'WATCH', 'SHOES', 'COSMETICS', 'ISLAMIC_PRODUCT', 'HOME');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "attributes" JSONB,
ADD COLUMN     "productType" "ProductType" NOT NULL DEFAULT 'CLOTHING';
