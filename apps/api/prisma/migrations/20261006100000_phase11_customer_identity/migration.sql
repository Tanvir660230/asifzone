-- Phase 11 (docs/PHASE_11_IMPLEMENTATION_CONTRACT.md §4, §10): customer identity integrity + DB-tracked customer sessions +
-- outbox correlation IDs. Additive only: new nullable columns, two new tables, one partial unique index. No backfill —
-- no existing phone is marked verified (BD-11.2), so the partial index below can never fail on existing duplicates.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "correlationId" TEXT;

-- CreateTable
CREATE TABLE "CustomerRefreshToken" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "persistent" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerClaim" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRefreshToken_tokenHash_key" ON "CustomerRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerRefreshToken_customerId_idx" ON "CustomerRefreshToken"("customerId");

-- CreateIndex
CREATE INDEX "CustomerRefreshToken_familyId_idx" ON "CustomerRefreshToken"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerClaim_tokenHash_key" ON "CustomerClaim"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerClaim_customerId_idx" ON "CustomerClaim"("customerId");

-- AddForeignKey
ALTER TABLE "CustomerRefreshToken" ADD CONSTRAINT "CustomerRefreshToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerClaim" ADD CONSTRAINT "CustomerClaim_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BD-11.1: at most one customer per *verified* phone. Unverified phones (contact data) may repeat. Prisma can't express a
-- partial index, so it lives here only (same pattern as ReturnRequest_orderId_pending_key, migration 20260810121000).
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_phone_verified_key" ON "Customer" ("phone") WHERE "phoneVerifiedAt" IS NOT NULL;
