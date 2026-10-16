-- Site health: anonymous Core Web Vitals samples (modules/ops/web-vitals.*). ADDITIVE: one new table.
-- CreateTable
CREATE TABLE "WebVitalSample" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "pageKind" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebVitalSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebVitalSample_createdAt_metric_idx" ON "WebVitalSample"("createdAt", "metric");

