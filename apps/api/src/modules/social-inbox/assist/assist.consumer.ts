import type { ConsumerResult } from "../../../domain/outbox/consumers";
import { prisma } from "../../../config/prisma";
import { getProviders } from "../../../providers/registry";
import { anthropicAssistantModel, isAiConfigured } from "../../ai/ai.service";
import { PLACEHOLDER_NAME } from "../ingest.service";
import { assistConversation } from "./assist.service";

/** Outbox consumer `conversation-assist`: put a name on a new Messenger / Instagram contact, then let the AI answer or
 * draft. A model failure throws, so the outbox retries it. */
export async function assistInboundMessage(messageId: string): Promise<ConsumerResult> {
  const message = await prisma.conversationMessage.findUnique({
    where: { id: messageId },
    select: { conversation: { select: { id: true, channel: true, contactName: true, externalThreadId: true } } },
  });
  if (!message) return "skipped";
  const c = message.conversation;
  if ((c.channel === "MESSENGER" || c.channel === "INSTAGRAM") && c.externalThreadId && c.contactName === PLACEHOLDER_NAME[c.channel]) {
    const name = await getProviders().social.profileName(c.channel, c.externalThreadId);
    if (name) await prisma.conversation.update({ where: { id: c.id }, data: { contactName: name } });
  }
  if (!isAiConfigured()) return "disabled";
  const outcome = await assistConversation(messageId, anthropicAssistantModel());
  return outcome === "auto" || outcome === "draft" ? "sent" : "skipped";
}
