import { replyWindow } from "@clothing-brand/shared";
import { renderEmailLayout } from "./email-template";
import { escapeHtml } from "./html";
import { getSettings } from "../modules/settings/settings.service";
import { prisma } from "../config/prisma";
import { latestComment, recordSentExternalId, replyFacts } from "../modules/inbox/inbox.service";
import { getProviders } from "../providers/registry";
import { MetaApiError } from "../providers/errors";

/** Delivers one Inbox reply (outbox consumer `conversation-reply`). "skipped" when the message is gone, isn't a reply,
 * was already sent, or the customer has no address for its channel; throws on a provider failure so the outbox retries
 * (or records it FAILED when Meta refused it — e.g. the reply window closed while it waited). */
export async function deliverConversationReply(messageId: string, eventId: string): Promise<"sent" | "skipped"> {
  const facts = await replyFacts(messageId);
  if (!facts || facts.direction !== "OUT") return "skipped";
  const { conversation } = facts;

  if (facts.channel === "WHATSAPP" || facts.channel === "MESSENGER" || facts.channel === "INSTAGRAM" || facts.channel === "FB_COMMENT") {
    if (facts.externalId) return "skipped"; // already sent (its id saved, or its echo already matched)
    const threadId = conversation.externalThreadId;
    if (!threadId) return "skipped";
    const social = getProviders().social;
    let externalId: string;
    if (conversation.channel === "FB_COMMENT") {
      // A comment thread is one person under one comment; the answer goes to their latest comment.
      const comment = await latestComment(prisma, facts.conversationId);
      if (!comment?.externalId) return "skipped";
      externalId = facts.channel === "MESSENGER" ? await social.privateReply(comment.externalId, facts.body) : await social.commentReply(comment.externalId, facts.body);
    } else {
      const window = replyWindow(facts.channel, conversation.lastInboundAt, new Date());
      if (!window.open) throw new MetaApiError("The reply window closed before this message could be sent", false);
      // Meta's HUMAN_AGENT tag is for people only: an AI answer that waited past 24 hours is not sent.
      if (window.humanAgentTag && facts.author === "AI") {
        throw new MetaApiError("The AI's answer missed Meta's 24-hour window — a person can still reply for up to 7 days", false);
      }
      externalId =
        facts.channel === "WHATSAPP"
          ? await social.whatsApp(threadId, facts.body)
          : await social.direct(threadId, facts.body, { humanAgentTag: window.humanAgentTag });
    }
    await recordSentExternalId(messageId, externalId);
    return "sent";
  }

  if (facts.channel === "SMS") {
    if (!conversation.phone) return "skipped";
    const { storeName } = await getSettings();
    await getProviders().sms.send({ to: conversation.phone, body: `${facts.body}\n— ${storeName}` });
    return "sent";
  }
  if (facts.channel !== "EMAIL" || !conversation.email) return "skipped";
  const bodyHtml = facts.body
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 16px;">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
  await getProviders().email.send({
    to: conversation.email,
    subject: `Re: ${conversation.subject}`,
    html: await renderEmailLayout({ bodyHtml }),
    idempotencyKey: eventId,
  });
  return "sent";
}
