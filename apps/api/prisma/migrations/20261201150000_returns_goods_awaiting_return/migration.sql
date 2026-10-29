-- Blueprint P0.4 (owner decisions Q5 = A, Q13 = C, Q13b = B, Q-A, Q-B, Q-C; tab 11): restock only at receipt, Goods
-- awaiting return. Additive: one table, four defaulted columns, one enum value. The rule stays OFF until the owner sets
-- FinanceBusiness."returnsReceiptRuleEffectiveAt" (NULL here), so nothing behaves differently after this migration.
-- Rollback note: an old Prisma client cannot read a ReturnRequest whose status is COMPLETED — only written once the rule
-- is on and a return is fully received.
-- AlterEnum
ALTER TYPE "ReturnRequestStatus" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "FinanceBusiness" ADD COLUMN     "returnLossDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "returnsReceiptRuleEffectiveAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "awaitingReturnQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnLostQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReturnExpectation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "returnRequestId" TEXT,
    "quantity" INTEGER NOT NULL,
    "receivedGood" INTEGER NOT NULL DEFAULT 0,
    "receivedDamaged" INTEGER NOT NULL DEFAULT 0,
    "lostQuantity" INTEGER NOT NULL DEFAULT 0,
    "lostReason" TEXT,
    "lostAt" TIMESTAMP(3),
    "lostByAdminId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AWAITING',
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnExpectation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnExpectation_orderId_idx" ON "ReturnExpectation"("orderId");

-- CreateIndex
CREATE INDEX "ReturnExpectation_orderItemId_idx" ON "ReturnExpectation"("orderItemId");

-- CreateIndex
CREATE INDEX "ReturnExpectation_returnRequestId_idx" ON "ReturnExpectation"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnExpectation_status_approvedAt_idx" ON "ReturnExpectation"("status", "approvedAt");

-- AddForeignKey
ALTER TABLE "ReturnExpectation" ADD CONSTRAINT "ReturnExpectation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnExpectation" ADD CONSTRAINT "ReturnExpectation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnExpectation" ADD CONSTRAINT "ReturnExpectation_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A line's units are accounted for at most once: received good + damaged + written off never exceed what was agreed back.
ALTER TABLE "ReturnExpectation" ADD CONSTRAINT "ReturnExpectation_quantities_check"
  CHECK ("quantity" > 0 AND "receivedGood" >= 0 AND "receivedDamaged" >= 0 AND "lostQuantity" >= 0
         AND "receivedGood" + "receivedDamaged" + "lostQuantity" <= "quantity");
ALTER TABLE "ReturnExpectation" ADD CONSTRAINT "ReturnExpectation_status_check" CHECK ("status" IN ('AWAITING', 'CLOSED', 'WITHDRAWN'));
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_return_units_check"
  CHECK ("awaitingReturnQuantity" >= 0 AND "returnLostQuantity" >= 0
         AND "restockedQuantity" + "awaitingReturnQuantity" + "returnLostQuantity" <= "quantity");
ALTER TABLE "FinanceBusiness" ADD CONSTRAINT "FinanceBusiness_returnLossDays_check" CHECK ("returnLossDays" BETWEEN 1 AND 365);
