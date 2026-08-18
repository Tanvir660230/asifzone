-- AlterTable
ALTER TABLE "SearchLog" ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "suggestion" TEXT,
ADD COLUMN     "visitorId" TEXT;

-- CreateIndex
CREATE INDEX "SearchLog_sessionId_idx" ON "SearchLog"("sessionId");
