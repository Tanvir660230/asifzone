-- Site health: grouped production errors (lib/observability/error-store-reporter.ts). ADDITIVE: one new table.
-- CreateTable
CREATE TABLE "ErrorGroup" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "errorClass" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sampleStack" TEXT,
    "lastPath" TEXT,
    "lastCorrelationId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ErrorGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErrorGroup_fingerprint_key" ON "ErrorGroup"("fingerprint");

-- CreateIndex
CREATE INDEX "ErrorGroup_resolvedAt_lastSeenAt_idx" ON "ErrorGroup"("resolvedAt", "lastSeenAt");

