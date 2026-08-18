-- AlterEnum
ALTER TYPE "FunnelEventType" ADD VALUE 'REMOVE_FROM_CART';

-- CreateIndex
CREATE INDEX "WishlistItem_productId_idx" ON "WishlistItem"("productId");
