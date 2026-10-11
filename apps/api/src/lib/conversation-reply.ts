import { renderEmailLayout } from "./email-template";
import { escapeHtml } from "./html";
import { getSettings } from "../modules/settings/settings.service";
import { replyFacts } from "../modules/inbox/inbox.service";
import { getProviders } from "../providers/registry";

/** Delivers one Inbox reply (outbox consumer `conversation-reply`). "skipped" when the message is gone or isn't a reply,
 * or the customer has no address for its channel; throws on a provider failure so the outbox retries. */
export async function deliverConversationReply(messageId: string, eventId: string): Promise<"sent" | "skipped"> {
  const facts = await replyFacts(messageId);
  if (!facts || facts.direction !== "OUT") return "skipped";
  const { conversation } = facts;
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
