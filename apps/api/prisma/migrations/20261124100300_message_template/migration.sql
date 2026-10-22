-- Social Inbox: a WhatsApp reply sent as an approved template (outside the 24-hour window) keeps the template it used.
ALTER TABLE "ConversationMessage" ADD COLUMN "template" JSONB;
