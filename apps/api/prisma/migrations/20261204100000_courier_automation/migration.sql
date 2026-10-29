-- Order Operations phase 5: courier automation. Additive: two settings with the plan's defaults (M8) and a run log.

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "returnNotBackDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "stuckInTransitDays" INTEGER NOT NULL DEFAULT 6;

-- CreateTable
CREATE TABLE "CourierAutomationRun" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL DEFAULT 'RUNNING',
    "stuckInTransit" INTEGER NOT NULL DEFAULT 0,
    "returnOverdue" INTEGER NOT NULL DEFAULT 0,
    "handoverPending" INTEGER NOT NULL DEFAULT 0,
    "payoutsChecked" INTEGER NOT NULL DEFAULT 0,
    "payoutProblems" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "CourierAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourierAutomationRun_day_key" ON "CourierAutomationRun"("day");

