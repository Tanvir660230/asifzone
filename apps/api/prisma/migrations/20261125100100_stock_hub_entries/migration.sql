-- Stock hub (docs/STOCK_HUB.md): Bought and Counted entries, keyed by their Idempotency-Key; each step's result is kept so a
-- retry resumes and a replay writes nothing.
CREATE TYPE "StockHubEntryKind" AS ENUM ('PURCHASE', 'COUNT');

CREATE TABLE "StockHubEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "StockHubEntryKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '{}',
    "completedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockHubEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockHubEntry_businessId_idempotencyKey_key" ON "StockHubEntry"("businessId", "idempotencyKey");
CREATE INDEX "StockHubEntry_businessId_kind_createdAt_idx" ON "StockHubEntry"("businessId", "kind", "createdAt");

ALTER TABLE "StockHubEntry" ADD CONSTRAINT "StockHubEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "FinanceBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
