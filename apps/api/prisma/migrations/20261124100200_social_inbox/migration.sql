-- Social Inbox: WhatsApp, Messenger, Instagram and Facebook comments land in the Inbox; the AI drafts or auto-answers.
ALTER TYPE "ConversationChannel" ADD VALUE 'INSTAGRAM';
ALTER TYPE "ConversationChannel" ADD VALUE 'FB_COMMENT';

CREATE TYPE "MessageAuthor" AS ENUM ('CUSTOMER', 'STAFF', 'AI', 'PHONE');

ALTER TABLE "Conversation" ADD COLUMN "externalThreadId" TEXT,
ADD COLUMN "lastInboundAt" TIMESTAMP(3),
ADD COLUMN "postId" TEXT;

ALTER TABLE "ConversationMessage" ADD COLUMN "author" "MessageAuthor" NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN "externalId" TEXT;

-- Every reply so far was typed by staff in the Inbox.
UPDATE "ConversationMessage" SET "author" = 'STAFF' WHERE "direction" = 'OUT';

CREATE TABLE "ConversationDraft" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "basedOnMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversation_channel_externalThreadId_key" ON "Conversation"("channel", "externalThreadId");
CREATE UNIQUE INDEX "ConversationMessage_externalId_key" ON "ConversationMessage"("externalId");
CREATE UNIQUE INDEX "ConversationDraft_conversationId_key" ON "ConversationDraft"("conversationId");

ALTER TABLE "ConversationDraft" ADD CONSTRAINT "ConversationDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
