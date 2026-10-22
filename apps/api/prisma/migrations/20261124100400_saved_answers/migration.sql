-- Social Inbox: the answer library — questions customers keep asking, learned from replies, answered without the AI.
CREATE TYPE "SavedAnswerStatus" AS ENUM ('SUGGESTED', 'APPROVED', 'DISMISSED');

ALTER TABLE "ConversationMessage" ADD COLUMN "savedAnswerId" TEXT;
ALTER TABLE "ConversationDraft" ADD COLUMN "savedAnswerId" TEXT;

CREATE TABLE "SavedAnswer" (
    "id" TEXT NOT NULL,
    "status" "SavedAnswerStatus" NOT NULL DEFAULT 'SUGGESTED',
    "title" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "corrections" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "autoPausedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnswerExample" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "source" "MessageAuthor" NOT NULL,
    "messageId" TEXT NOT NULL,
    "savedAnswerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerExample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationMessage_savedAnswerId_createdAt_idx" ON "ConversationMessage"("savedAnswerId", "createdAt");
CREATE INDEX "SavedAnswer_status_idx" ON "SavedAnswer"("status");
CREATE UNIQUE INDEX "AnswerExample_messageId_key" ON "AnswerExample"("messageId");
CREATE INDEX "AnswerExample_savedAnswerId_idx" ON "AnswerExample"("savedAnswerId");
CREATE INDEX "AnswerExample_createdAt_idx" ON "AnswerExample"("createdAt");

ALTER TABLE "AnswerExample" ADD CONSTRAINT "AnswerExample_savedAnswerId_fkey" FOREIGN KEY ("savedAnswerId") REFERENCES "SavedAnswer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
