-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "callAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "followUpAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_followUpAt_idx" ON "Order"("followUpAt");
