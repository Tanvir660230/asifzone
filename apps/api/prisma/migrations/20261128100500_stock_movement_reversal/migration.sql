-- Stock correction (docs/STOCK_HUB.md §10): a movement that reverses another exactly, at most once.
-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "reversesMovementId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_reversesMovementId_key" ON "StockMovement"("reversesMovementId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversesMovementId_fkey" FOREIGN KEY ("reversesMovementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

