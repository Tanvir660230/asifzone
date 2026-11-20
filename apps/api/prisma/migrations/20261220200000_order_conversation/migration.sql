-- Chat to order: the Inbox conversation an order was made from (nullable; checkout and phone orders have none).
ALTER TABLE "Order" ADD COLUMN "conversationId" TEXT;
CREATE INDEX "Order_conversationId_idx" ON "Order"("conversationId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
