-- Admin V2 Inbox: who is handling a conversation.
ALTER TABLE "Conversation" ADD COLUMN "assignedToId" TEXT;
CREATE INDEX "Conversation_assignedToId_idx" ON "Conversation"("assignedToId");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
