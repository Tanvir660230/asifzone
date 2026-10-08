-- Admin V2 Inbox R2 (DR-4): conversations and their messages.
CREATE TYPE "ConversationChannel" AS ENUM ('WEB_FORM', 'EMAIL', 'SMS', 'WHATSAPP', 'MESSENGER');
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'HANDLED');
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "subject" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "customerId" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feedbackId" TEXT,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "body" TEXT NOT NULL,
    "adminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversation_feedbackId_key" ON "Conversation"("feedbackId");
CREATE INDEX "Conversation_status_lastMessageAt_idx" ON "Conversation"("status", "lastMessageAt");
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every contact-form message becomes a WEB_FORM conversation with its message; read = handled.
INSERT INTO "Conversation" ("id", "channel", "subject", "contactName", "email", "phone", "customerId", "status", "lastMessageAt", "createdAt", "feedbackId")
SELECT f."id", 'WEB_FORM', f."subject", f."name", f."email", f."phone",
       (SELECT c."id" FROM "Customer" c WHERE f."phone" IS NOT NULL AND c."phone" = f."phone" AND c."phoneVerifiedAt" IS NOT NULL LIMIT 1),
       CASE WHEN f."readAt" IS NULL THEN 'OPEN'::"ConversationStatus" ELSE 'HANDLED'::"ConversationStatus" END,
       f."createdAt", f."createdAt", f."id"
FROM "Feedback" f;

INSERT INTO "ConversationMessage" ("id", "conversationId", "direction", "channel", "body", "createdAt")
SELECT 'fbm_' || f."id", f."id", 'IN', 'WEB_FORM', f."message", f."createdAt"
FROM "Feedback" f;
