-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "restockDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProductViewLog" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductViewLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductViewLog_productId_createdAt_idx" ON "ProductViewLog"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductViewLog" ADD CONSTRAINT "ProductViewLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
