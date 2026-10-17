import { replyWindow } from "@clothing-brand/shared";
import { prisma } from "../../../config/prisma";
import { env } from "../../../config/env";
import type { AiModel, ModelMessage } from "../../../domain/ai/chat.service";
import { getSettings } from "../../settings/settings.service";
import { queueReply } from "../../inbox/inbox.service";
import { ASSIST_TOOLS, respondInput, runAssistTool, type AssistContext, type IntentName, type RespondInput } from "./tools";
import { COMMENT_ACK, assistSystemPrompt } from "./prompt";

/**
 * The Inbox AI (Social Inbox, owner 2026-10-17): it reads a new customer message, looks things up with read-only tools,
 * and either answers a factual question itself or leaves a draft for staff. The model only proposes — every rule that
 * keeps an auto-sent answer safe is enforced here, whatever the model says.
 */

const MAX_STEPS = 6;
const CONTEXT_MESSAGES = 12;
const HOUR = 3_600_000;
/** After a person answered (Inbox or phone), the AI stays out of the thread this long: drafts only. */
const HUMAN_QUIET_MS = 12 * HOUR;
/** At most this many AI answers per thread per day — a guard against loops and an over-eager model. */
const MAX_AUTO_PER_DAY = 3;
const MEDIA_ONLY = /^\[[^\]]+\]$/;

export type AssistOutcome = "auto" | "draft" | "none" | "skipped";

export async function assistConversation(messageId: string, model: AiModel, now: Date = new Date()): Promise<AssistOutcome> {
  const message = await prisma.conversationMessage.findUnique({
    where: { id: messageId },
    select: { id: true, direction: true, body: true, createdAt: true, conversationId: true },
  });
  if (!message || message.direction !== "IN") return "skipped";
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: message.conversationId },
    select: { id: true, channel: true, phone: true, lastInboundAt: true },
  });

  // A burst of messages is answered once, for the latest; a thread someone already answered is left alone.
  const later = await prisma.conversationMessage.findFirst({
    where: { conversationId: conversation.id, id: { not: message.id }, createdAt: { gte: message.createdAt } },
    select: { direction: true },
  });
  if (later) return "skipped";

  const history = await prisma.conversationMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: CONTEXT_MESSAGES,
    select: { direction: true, author: true, body: true, channel: true, createdAt: true },
  });
  history.reverse();

  const ctx: AssistContext = { channel: conversation.channel, phone: conversation.phone };
  const { storeName } = await getSettings();
  const system = assistSystemPrompt({ storeName, siteUrl: env.webOrigin.replace(/\/+$/, ""), today: now.toISOString().slice(0, 10), channel: channelName(conversation.channel) });
  const transcript = history
    .map((m) => `${m.direction === "IN" ? "Customer" : m.author === "AI" ? "Store (AI)" : "Store"}: ${m.body}`)
    .join("\n");
  const messages: ModelMessage[] = [{ role: "user", content: `Conversation so far:\n${transcript}\n\nAnswer the customer's latest message, then call respond.` }];

  const backed = new Set<IntentName>();
  let decision: RespondInput | null = null;
  for (let step = 0; step < MAX_STEPS && !decision; step++) {
    const res = await model.create({ system, messages, tools: ASSIST_TOOLS as unknown as Parameters<AiModel["create"]>[0]["tools"] });
    messages.push({ role: "assistant", content: res.content });
    const calls = res.content.filter((b) => b.type === "tool_use");
    if (calls.length === 0) {
      // Answered in plain text without deciding: keep it, but only as a draft.
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
      if (text) decision = { action: "draft", intent: "other", body: text.slice(0, 1000) };
      break;
    }
    const results: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }> = [];
    for (const call of calls) {
      if (call.name === "respond") {
        const parsed = respondInput.safeParse(call.input);
        if (parsed.success) decision = parsed.data;
        results.push({ type: "tool_result", tool_use_id: call.id, content: parsed.success ? "ok" : "Invalid respond input", ...(parsed.success ? {} : { is_error: true }) });
        continue;
      }
      try {
        const outcome = await runAssistTool(call.name, call.input, ctx);
        outcome.backs.forEach((i) => backed.add(i));
        results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.content });
      } catch {
        results.push({ type: "tool_result", tool_use_id: call.id, content: "The lookup failed", is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }

  if (!decision || decision.action === "none" || !decision.body) return "none";

  const auto = decision.action === "auto" && (await mayAutoSend(decision, backed, conversation, message.body, now));
  return prisma.$transaction(async (tx) => {
    // Re-check inside the transaction: staff may have answered while the model was thinking.
    const answered = await tx.conversationMessage.findFirst({
      where: { conversationId: conversation.id, createdAt: { gte: message.createdAt }, id: { not: message.id } },
      select: { id: true },
    });
    if (answered) return "skipped" as const;
    if (!auto) {
      await tx.conversationDraft.upsert({
        where: { conversationId: conversation.id },
        create: { conversationId: conversation.id, body: decision!.body, intent: decision!.intent, basedOnMessageId: message.id },
        update: { body: decision!.body, intent: decision!.intent, basedOnMessageId: message.id, createdAt: now },
      });
      return "draft" as const;
    }
    if (conversation.channel === "FB_COMMENT") {
      // The answer goes privately (prices in public invite haggling under the post); the comment gets a pointer to it.
      await queueReply(tx, { conversationId: conversation.id, channel: "MESSENGER", body: decision!.body, adminId: null, author: "AI" });
      await queueReply(tx, { conversationId: conversation.id, channel: "FB_COMMENT", body: COMMENT_ACK, adminId: null, author: "AI" });
    } else {
      await queueReply(tx, { conversationId: conversation.id, channel: conversation.channel as "WHATSAPP" | "MESSENGER" | "INSTAGRAM", body: decision!.body, adminId: null, author: "AI" });
    }
    return "auto" as const;
  });
}

const FACTUAL: ReadonlySet<IntentName> = new Set(["price", "stock", "delivery_charge", "order_status", "how_to_order"]);

/** Every condition an AI answer must meet to go out without a person. */
async function mayAutoSend(
  decision: RespondInput,
  backed: Set<IntentName>,
  conversation: { id: string; channel: AssistContext["channel"]; lastInboundAt: Date | null },
  latestBody: string,
  now: Date,
): Promise<boolean> {
  if (env.inboxAi.autoReply !== "factual") return false;
  if (!FACTUAL.has(decision.intent)) return false;
  if (decision.intent !== "how_to_order" && !backed.has(decision.intent)) return false;
  if (MEDIA_ONLY.test(latestBody.trim())) return false;
  if (conversation.channel !== "WHATSAPP" && conversation.channel !== "MESSENGER" && conversation.channel !== "INSTAGRAM" && conversation.channel !== "FB_COMMENT") return false;
  if (conversation.channel !== "FB_COMMENT") {
    const window = replyWindow(conversation.channel, conversation.lastInboundAt, now);
    if (!window.open || window.humanAgentTag) return false; // the HUMAN_AGENT tag is for people only
  }
  const [human, aiToday, privateReplied] = await Promise.all([
    prisma.conversationMessage.count({ where: { conversationId: conversation.id, author: { in: ["STAFF", "PHONE"] }, createdAt: { gte: new Date(now.getTime() - HUMAN_QUIET_MS) } } }),
    prisma.conversationMessage.count({ where: { conversationId: conversation.id, author: "AI", createdAt: { gte: new Date(now.getTime() - 24 * HOUR) } } }),
    // Meta allows one private reply per comment.
    conversation.channel === "FB_COMMENT" ? prisma.conversationMessage.count({ where: { conversationId: conversation.id, direction: "OUT", channel: "MESSENGER" } }) : 0,
  ]);
  return human === 0 && aiToday < MAX_AUTO_PER_DAY && privateReplied === 0;
}

function channelName(channel: AssistContext["channel"]): string {
  return { WHATSAPP: "WhatsApp", MESSENGER: "Facebook Messenger", INSTAGRAM: "Instagram DM", FB_COMMENT: "a comment on a Facebook post", WEB_FORM: "the website contact form", EMAIL: "email", SMS: "SMS" }[channel];
}
