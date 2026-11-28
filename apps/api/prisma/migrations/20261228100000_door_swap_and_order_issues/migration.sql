-- Door-swap exchange + customer-reported item problems (docs/superpowers/plans/2026-11-28-door-swap-exchange.md). Additive only.
-- CreateEnum
CREATE TYPE "ExchangeReason" AS ENUM ('CUSTOMER_SIZE', 'CUSTOMER_COLOR', 'WRONG_ITEM_SENT', 'DEFECT');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('AWAITING_SWAP', 'SWAPPED', 'KEPT_BOTH', 'REFUSED', 'OLD_RECEIVED', 'OLD_MISSING');

-- CreateEnum
CREATE TYPE "OrderIssueKind" AS ENUM ('TORN', 'STAIN', 'BROKEN_PART', 'COLOR_DIFFERENT', 'WRONG_ITEM', 'OTHER');

-- CreateEnum
CREATE TYPE "IssueChannel" AS ENUM ('CALL', 'WHATSAPP', 'MESSENGER', 'OTHER');

-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "evidenceNote" TEXT,
ADD COLUMN     "exchangeFee" DECIMAL(10,2),
ADD COLUMN     "exchangeReason" "ExchangeReason",
ADD COLUMN     "issueId" TEXT,
ADD COLUMN     "overrideReason" TEXT,
ADD COLUMN     "protectedCod" DECIMAL(10,2),
ADD COLUMN     "swap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "swapStatus" "SwapStatus";

-- CreateTable
CREATE TABLE "OrderIssue" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "kind" "OrderIssueKind" NOT NULL,
    "channel" "IssueChannel" NOT NULL DEFAULT 'CALL',
    "note" TEXT NOT NULL,
    "reportedByAdminId" TEXT,
    "reportedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "OrderIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderIssue_orderId_idx" ON "OrderIssue"("orderId");

-- CreateIndex
CREATE INDEX "ReturnRequest_orderItemId_swapStatus_idx" ON "ReturnRequest"("orderItemId", "swapStatus");

-- AddForeignKey
ALTER TABLE "OrderIssue" ADD CONSTRAINT "OrderIssue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
