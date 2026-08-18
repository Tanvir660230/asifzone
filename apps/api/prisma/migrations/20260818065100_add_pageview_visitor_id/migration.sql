-- AlterTable
ALTER TABLE "PageView" ADD COLUMN     "visitorId" TEXT;

-- CreateIndex
CREATE INDEX "PageView_visitorId_idx" ON "PageView"("visitorId");
