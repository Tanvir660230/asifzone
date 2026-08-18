-- CreateEnum
CREATE TYPE "FunnelEventType" AS ENUM ('VARIANT_SELECTED', 'ADD_TO_CART');

-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT,
    "type" "FunnelEventType" NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "path" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FunnelEvent_sessionId_type_idx" ON "FunnelEvent"("sessionId", "type");

-- CreateIndex
CREATE INDEX "FunnelEvent_type_createdAt_idx" ON "FunnelEvent"("type", "createdAt");
