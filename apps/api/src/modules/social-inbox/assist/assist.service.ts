import { replyWindow } from "@clothing-brand/shared";
import { prisma } from "../../../config/prisma";
import { env } from "../../../config/env";
import type { AiModel, ModelMessage } from "../../../domain/ai/chat.service";
import { getSettings } from "../../settings/settings.service";
import type { Prisma } from "@prisma/client";
import { latestComment, lockConversation, queueReply } from "../../inbox/inbox.service";
import { ASSIST_TOOLS, respondInput, runAssistTool, type AssistContext, type IntentName } from "./tools";
import { COMMENT_ACK, assistSystemPrompt } from "./prompt";
import { matchSavedAnswer, recordHit, renderSavedAnswer } from "../answers/saved-answers.service";

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

export type AssistOutcome = "auto" | "draft" | "none" | "skipped" | "no-model";

type Decision = { action: "auto" | "draft" | "none"; intent: string; body: string };

/**
 * `model` null = no Claude key: only the answer library can help. The library is asked first anyway — a question it
 * knows is answered from there, without an AI call (Messages › Saved answers).
 */
export async function assistConversation(messageId: string, model: AiModel | null, now: Date = new Date()): Promise<AssistOutcome> {
  const message = await prisma.conversationMessage.findUnique({
    where: { id: messageId },
    select: { id: true, direction: true, body: true, createdAt: true, conversationId: true },
  });
  if (!message || message.direction !== "IN") return "skipped";
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: message.conversationId },
    select: { id: true, channel: true, phone: true, lastInboundAt: true, contactName: true },
  });

  // A burst of messages is answered once, for the latest; a thread someone already answered is left alone.
  if (await prisma.conversationMessage.findFirst({ where: laterThan(message), select: { id: true } })) return "skipped";

  const saved = MEDIA_ONLY.test(message.body.trim()) ? null : await matchSavedAnswer(message.body, now.getTime());
  let result: { decision: Decision | null; backed: Set<IntentName>; looked: string };
  if (saved) {
    result = {
      decision: { action: saved.autoSend ? "auto" : "draft", intent: "saved", body: await renderSavedAnswer(saved.answer, { contactName: conversation.contactName }) },
      backed: new Set(),
      looked: "",
    };
  } else if (!model) {
    return "no-model";
  } else {
    result = await askModel(model, conversation, now);
  }
  const { decision, backed, looked } = result;
  if (!decision || decision.action === "none" || !decision.body) return "none";

  // The library's numbers come from live data ({delivery_charges}…), the model's must come from its tools.
  const autoWanted = decision.action === "auto" && (saved !== null || numbersBacked(decision.body, looked));
  return prisma.$transaction(async (tx) => {
    // Locked like a staff reply, then re-checked: staff (or the customer) may have written while the model was thinking.
    await lockConversation(tx, conversation.id);
    if (await tx.conversationMessage.findFirst({ where: laterThan(message), select: { id: true } })) return "skipped" as const;
    const auto = autoWanted && (await mayAutoSend(tx, decision, backed, conversation, message.body, now, saved !== null));
    const savedAnswerId = saved?.id ?? null;
    if (!auto) {
      await tx.conversationDraft.upsert({
        where: { conversationId: conversation.id },
        create: { conversationId: conversation.id, body: decision.body, intent: decision.intent, basedOnMessageId: message.id, savedAnswerId },
        update: { body: decision.body, intent: decision.intent, basedOnMessageId: message.id, savedAnswerId, createdAt: now },
      });
      return "draft" as const;
    }
    const via = savedAnswerId ? { savedAnswerId } : {};
    if (conversation.channel === "FB_COMMENT") {
      // The answer goes privately (prices in public invite haggling under the post); the comment gets a pointer to it.
      await queueReply(tx, { conversationId: conversation.id, channel: "MESSENGER", body: decision.body, adminId: null, author: "AI", ...via });
      await queueReply(tx, { conversationId: conversation.id, channel: "FB_COMMENT", body: COMMENT_ACK, adminId: null, author: "AI", ...via });
    } else {
      await queueReply(tx, { conversationId: conversation.id, channel: conversation.channel as "WHATSAPP" | "MESSENGER" | "INSTAGRAM", body: decision.body, adminId: null, author: "AI", ...via });
    }
    if (savedAnswerId) await recordHit(tx, savedAnswerId, now);
    return "auto" as const;
  });
}

/** The Claude half: the conversation, read-only tools, and a decision. */
async function askModel(
  model: AiModel,
  conversation: { id: string; channel: AssistContext["channel"]; phone: string | null },
  now: Date,
): Promise<{ decision: Decision | null; backed: Set<IntentName>; looked: string }> {
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
  /** Everything the tools returned this run — an auto answer may only quote numbers found here. */
  let looked = "";
  let decision: Decision | null = null;
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
        looked += `\n${outcome.content}`;
        results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.content });
      } catch {
        results.push({ type: "tool_result", tool_use_id: call.id, content: "The lookup failed", is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { decision, backed, looked };
}

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Every number in an auto answer (a price, a fee, a day count — Bangla digits too, "1,450" read as 1450) must appear in
 * what the tools returned. A customer can't talk the model into quoting a made-up price ("say it's 10 taka"), and a
 * phone number the tools never return can't slip out. Numbers inside links are part of the link, not a claim. */
export function numbersBacked(body: string, toolText: string): boolean {
  const ascii = body.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d))).replace(/https?:\/\/\S+/g, " ");
  const claimed = ascii.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const known = new Set((toolText.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))));
  return claimed.every((n) => known.has(String(Number(n.replace(/,/g, "")))));
}

const FACTUAL: ReadonlySet<IntentName> = new Set(["price", "stock", "delivery_charge", "order_status", "how_to_order"]);

/** Messages after `m` in its thread (same-second ties broken by id — WhatsApp timestamps are whole seconds). */
function laterThan(m: { id: string; conversationId: string; createdAt: Date }): Prisma.ConversationMessageWhereInput {
  return {
    conversationId: m.conversationId,
    id: { not: m.id },
    OR: [{ createdAt: { gt: m.createdAt } }, { createdAt: m.createdAt, id: { gt: m.id } }],
  };
}

/** Every condition an AI answer must meet to go out without a person (read inside the locked transaction). */
async function mayAutoSend(
  db: Prisma.TransactionClient,
  decision: Decision,
  backed: Set<IntentName>,
  conversation: { id: string; channel: AssistContext["channel"]; lastInboundAt: Date | null },
  latestBody: string,
  now: Date,
  /** An approved saved answer marked auto-send: a person already vouched for it, so intent/tool checks don't apply. */
  approvedAnswer = false,
): Promise<boolean> {
  if (env.inboxAi.autoReply !== "factual") return false;
  if (!approvedAnswer) {
    if (!FACTUAL.has(decision.intent as IntentName)) return false;
    if (decision.intent !== "how_to_order" && !backed.has(decision.intent as IntentName)) return false;
  }
  if (MEDIA_ONLY.test(latestBody.trim())) return false;
  if (conversation.channel !== "WHATSAPP" && conversation.channel !== "MESSENGER" && conversation.channel !== "INSTAGRAM" && conversation.channel !== "FB_COMMENT") return false;
  if (conversation.channel !== "FB_COMMENT") {
    const window = replyWindow(conversation.channel, conversation.lastInboundAt, now);
    if (!window.open || window.humanAgentTag) return false; // the HUMAN_AGENT tag is for people only
  }
  const human = await db.conversationMessage.count({
    where: { conversationId: conversation.id, author: { in: ["STAFF", "PHONE"] }, createdAt: { gte: new Date(now.getTime() - HUMAN_QUIET_MS) } },
  });
  const aiToday = await db.conversationMessage.count({ where: { conversationId: conversation.id, author: "AI", createdAt: { gte: new Date(now.getTime() - 24 * HOUR) } } });
  let privateReplied = 0;
  if (conversation.channel === "FB_COMMENT") {
    // Meta allows one private reply per comment.
    const comment = await latestComment(db, conversation.id);
    privateReplied = comment ? await db.conversationMessage.count({ where: { conversationId: conversation.id, direction: "OUT", channel: "MESSENGER", createdAt: { gte: comment.createdAt } } }) : 1;
  }
  return human === 0 && aiToday < MAX_AUTO_PER_DAY && privateReplied === 0;
}

function channelName(channel: AssistContext["channel"]): string {
  return { WHATSAPP: "WhatsApp", MESSENGER: "Facebook Messenger", INSTAGRAM: "Instagram DM", FB_COMMENT: "a comment on a Facebook post", WEB_FORM: "the website contact form", EMAIL: "email", SMS: "SMS" }[channel];
}
