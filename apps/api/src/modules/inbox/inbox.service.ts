import type { Prisma } from "@prisma/client";
import {
  normalizeBdPhone,
  replyChannelsFor,
  replyWindow,
  type ReplyChannel,
  type ConversationDetail,
  type ConversationListQuery,
  type ConversationListRow,
  type ConversationMessageRow,
  type ConversationReplyInput,
  type CreateFeedbackInput,
  type MessageDelivery,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { recordOutboxEvents } from "../../domain/outbox/outbox";

/**
 * Admin V2 Inbox R2 (DR-4, owner 2026-10-08). A conversation is one thread with a customer; staff reply by email or SMS.
 * A reply is a ConversationMessage plus an outbox intent in the same transaction (consumer `conversation-reply`,
 * eventKey = the message id), so a reply is recorded if and only if it will be sent. Its delivery state is read back from
 * that outbox row — the consumer never writes business data.
 */
export const REPLY_CONSUMER = "conversation-reply" as const;

/** The storefront contact form: opens a WEB_FORM conversation. Anyone can type any number into the form, so it is linked
 * only to the customer who has VERIFIED that phone — a convenience for staff ("customer with this number"), never proof
 * of who wrote it (Phase 11: no raw phone identity). */
export async function openWebConversation(input: CreateFeedbackInput) {
  const phone = input.phone ? normalizeBdPhone(input.phone) : null;
  const customer = phone ? await prisma.customer.findFirst({ where: { phone, phoneVerifiedAt: { not: null } }, select: { id: true } }) : null;
  return prisma.conversation.create({
    data: {
      channel: "WEB_FORM",
      subject: input.subject,
      contactName: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      customerId: customer?.id ?? null,
      messages: { create: { direction: "IN", channel: "WEB_FORM", body: input.message } },
    },
  });
}

export async function listConversations(query: ConversationListQuery, adminId?: string) {
  const where: Prisma.ConversationWhereInput = {
    ...(query.status === "open" ? { status: "OPEN" } : query.status === "handled" ? { status: "HANDLED" } : {}),
    ...(query.mine === "true" && adminId ? { assignedToId: adminId } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.search
      ? {
          OR: [
            { contactName: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
            { phone: { contains: query.search } },
            { subject: { contains: query.search, mode: "insensitive" } },
            { messages: { some: { body: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const page = await paginate(
    query,
    (p) =>
      prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        ...p,
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
          _count: { select: { messages: true } },
          assignedTo: { select: { id: true, name: true } },
          draft: { select: { id: true } },
        },
      }),
    () => prisma.conversation.count({ where }),
  );
  const items: ConversationListRow[] = page.items.map((c) => ({
    id: c.id,
    channel: c.channel,
    subject: c.subject,
    contactName: c.contactName,
    email: c.email,
    phone: c.phone,
    status: c.status,
    lastMessageAt: c.lastMessageAt.toISOString(),
    preview: (c.messages[0]?.body ?? "").split("\n")[0]!.slice(0, 160),
    messageCount: c._count.messages,
    assignedTo: c.assignedTo,
    hasDraft: c.draft !== null,
  }));
  return { ...page, items };
}

/** A reply sent from outside the Inbox (a PHONE echo) has no outbox row — Meta already delivered it. */
function deliveryOf(status: string | undefined, externalId: string | null): MessageDelivery {
  if (status === "PROCESSED" || (status === undefined && externalId)) return "sent";
  if (status === "FAILED") return "failed";
  return "sending";
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const c = await prisma.conversation.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "asc" }, include: { admin: { select: { name: true } } } },
      draft: { select: { body: true, intent: true } },
    },
  });
  if (!c) throw AppError.notFound("Conversation not found");
  const outIds = c.messages.filter((m) => m.direction === "OUT").map((m) => m.id);
  const events = outIds.length
    ? await prisma.outboxEvent.findMany({ where: { consumer: REPLY_CONSUMER, eventKey: { in: outIds } }, select: { eventKey: true, status: true, lastError: true } })
    : [];
  const byKey = new Map(events.map((e) => [e.eventKey, e]));
  const messages: ConversationMessageRow[] = c.messages.map((m) => {
    const event = m.direction === "OUT" ? byKey.get(m.id) : undefined;
    const delivery = m.direction === "OUT" ? deliveryOf(event?.status, m.externalId) : null;
    return {
      id: m.id,
      direction: m.direction,
      channel: m.channel,
      body: m.body,
      author: m.author,
      createdAt: m.createdAt.toISOString(),
      by: m.admin?.name ?? null,
      delivery,
      deliveryError: delivery === "failed" ? (event?.lastError ?? null) : null,
    };
  });
  return {
    id: c.id,
    channel: c.channel,
    subject: c.subject,
    contactName: c.contactName,
    email: c.email,
    phone: c.phone,
    status: c.status,
    lastMessageAt: c.lastMessageAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    customer: c.customer,
    assignedTo: c.assignedTo,
    messages,
    draft: c.draft,
    replyWindow: replyWindow(c.channel, c.lastInboundAt, new Date()),
    replyChannels:
      c.channel === "FB_COMMENT" && !(await privateReplyOpen(prisma, c.id, new Date()))
        ? replyChannelsFor(c).filter((ch) => ch !== "MESSENGER")
        : replyChannelsFor(c),
  };
}

/** Records a reply and its send intent in one transaction; replying marks the conversation handled. */
/** Records one reply and its send intent (outbox `conversation-reply`) inside the caller's transaction; the thread
 * becomes handled and its AI draft, now answered, is removed. Shared by staff replies and the AI's own answers. */
export async function queueReply(
  tx: Prisma.TransactionClient,
  input: { conversationId: string; channel: ReplyChannel; body: string; adminId: string | null; author: "STAFF" | "AI" },
) {
  const m = await tx.conversationMessage.create({
    data: { conversationId: input.conversationId, direction: "OUT", channel: input.channel, body: input.body, adminId: input.adminId, author: input.author },
    include: { admin: { select: { name: true } } },
  });
  await tx.conversation.update({ where: { id: input.conversationId }, data: { status: "HANDLED", lastMessageAt: m.createdAt } });
  await tx.conversationDraft.deleteMany({ where: { conversationId: input.conversationId } });
  await recordOutboxEvents(tx, [
    {
      eventType: "conversation.reply_requested.v1",
      consumer: REPLY_CONSUMER,
      eventKey: m.id,
      aggregateType: "conversation",
      aggregateId: input.conversationId,
      payload: { messageId: m.id },
    },
  ]);
  return m;
}

const WINDOW_CLOSED: Partial<Record<ReplyChannel, string>> = {
  WHATSAPP: "WhatsApp only allows replies within 24 hours of the customer's last message — reply by SMS instead.",
  MESSENGER: "Messenger only allows replies within 7 days of the customer's last message.",
  INSTAGRAM: "Instagram only allows replies within 7 days of the customer's last message.",
};

/** Serialises replies to one conversation (staff and the AI): whoever comes second sees the first one's reply. NO KEY
 * UPDATE, so the webhook can still add customer messages meanwhile. */
export async function lockConversation(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Conversation" WHERE "id" = ${id} FOR NO KEY UPDATE`;
  return rows.length > 0;
}

const PRIVATE_REPLY_MS = 7 * 24 * 3_600_000;

/** The comment a reply on a FB_COMMENT thread answers: the customer's latest one. */
export function latestComment(tx: Prisma.TransactionClient | typeof prisma, conversationId: string) {
  return tx.conversationMessage.findFirst({
    where: { conversationId, direction: "IN" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, externalId: true, createdAt: true },
  });
}

/** Whether the customer's latest comment can still get its one private reply (for the composer's options). */
async function privateReplyOpen(db: Prisma.TransactionClient | typeof prisma, conversationId: string, now: Date): Promise<boolean> {
  const comment = await latestComment(db, conversationId);
  if (!comment || now.getTime() - comment.createdAt.getTime() > PRIVATE_REPLY_MS) return false;
  return (await db.conversationMessage.count({ where: { conversationId, direction: "OUT", channel: "MESSENGER", createdAt: { gte: comment.createdAt } } })) === 0;
}

/** Meta allows one private reply per comment, within 7 days of it. */
async function assertPrivateReplyAllowed(tx: Prisma.TransactionClient, conversationId: string, now: Date) {
  const comment = await latestComment(tx, conversationId);
  if (!comment || now.getTime() - comment.createdAt.getTime() > PRIVATE_REPLY_MS) {
    throw AppError.badRequest("A private message can only be sent within 7 days of the comment — reply publicly instead.", { code: "WINDOW_CLOSED" });
  }
  const used = await tx.conversationMessage.count({ where: { conversationId, direction: "OUT", channel: "MESSENGER", createdAt: { gte: comment.createdAt } } });
  if (used > 0) {
    throw AppError.badRequest("This comment already got its one private message — reply publicly, or wait for them to write in Messenger.", { code: "PRIVATE_REPLY_USED" });
  }
}

export async function replyToConversation(id: string, input: ConversationReplyInput, adminId: string): Promise<ConversationMessageRow> {
  const message = await prisma.$transaction(async (tx) => {
    if (!(await lockConversation(tx, id))) throw AppError.notFound("Conversation not found");
    const c = await tx.conversation.findUnique({ where: { id }, select: { id: true, channel: true, email: true, phone: true, lastInboundAt: true } });
    if (!c) throw AppError.notFound("Conversation not found");
    if (input.channel === "EMAIL" && !c.email) throw AppError.badRequest("This customer left no email address — reply by SMS", { code: "NO_EMAIL" });
    if (input.channel === "SMS" && !c.phone) throw AppError.badRequest("This customer left no phone number — reply by email", { code: "NO_PHONE" });
    if (!replyChannelsFor(c).includes(input.channel)) {
      throw AppError.badRequest("This conversation can't be answered on that channel", { code: "WRONG_CHANNEL" });
    }
    if (c.channel === "FB_COMMENT") {
      // A public reply has no window; a private one has Meta's own rule.
      if (input.channel === "MESSENGER") await assertPrivateReplyAllowed(tx, id, new Date());
    } else if (!replyWindow(input.channel, c.lastInboundAt, new Date()).open) {
      throw AppError.badRequest(WINDOW_CLOSED[input.channel] ?? "The reply window has closed", { code: "WINDOW_CLOSED" });
    }
    return queueReply(tx, { conversationId: id, channel: input.channel, body: input.body, adminId, author: "STAFF" });
  });
  return {
    id: message.id,
    direction: "OUT",
    channel: message.channel,
    body: message.body,
    author: message.author,
    createdAt: message.createdAt.toISOString(),
    by: message.admin?.name ?? null,
    delivery: "sending",
    deliveryError: null,
  };
}

/** Handled ↔ new, and/or assign to the admin asking (or clear it). */
export async function updateConversation(id: string, input: { status?: "OPEN" | "HANDLED"; assignedToMe?: boolean }, adminId: string) {
  const exists = await prisma.conversation.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw AppError.notFound("Conversation not found");
  return prisma.conversation.update({
    where: { id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.assignedToMe !== undefined ? { assignedToId: input.assignedToMe ? adminId : null } : {}),
    },
    select: { id: true, status: true, assignedTo: { select: { id: true, name: true } } },
  });
}

/** Staff threw the AI's suggestion away. */
export async function discardDraft(id: string) {
  await prisma.conversationDraft.deleteMany({ where: { conversationId: id } });
}

export async function deleteConversation(id: string) {
  const deleted = await prisma.conversation.deleteMany({ where: { id } });
  if (deleted.count === 0) throw AppError.notFound("Conversation not found");
}

/** Open conversations — the Messages badge (attention composite). */
export function countOpenConversations() {
  return prisma.conversation.count({ where: { status: "OPEN" } });
}

/** What the `conversation-reply` consumer needs at send time. */
export function replyFacts(messageId: string) {
  return prisma.conversationMessage.findUnique({
    where: { id: messageId },
    select: {
      body: true,
      channel: true,
      direction: true,
      author: true,
      externalId: true,
      conversationId: true,
      conversation: { select: { subject: true, contactName: true, email: true, phone: true, channel: true, externalThreadId: true, lastInboundAt: true } },
    },
  });
}

/**
 * The consumer's one write: Meta's id for the message it just sent, so the webhook echo of it is a known duplicate.
 * Never fails on the id being taken — that would retry, i.e. send again — because the echo can win the race:
 * - stored as a "from the phone" copy (e.g. a private reply's echo lands on a new Messenger thread) → that copy is ours,
 *   so it goes (with its thread, if nothing else is in it);
 * - claimed by an identical reply of ours queued alongside → the id is handed over.
 */
export async function recordSentExternalId(messageId: string, externalId: string) {
  await prisma.$transaction(async (tx) => {
    const holder = await tx.conversationMessage.findUnique({ where: { externalId }, select: { id: true, author: true, conversationId: true } });
    if (holder && holder.id !== messageId) {
      if (holder.author === "PHONE") {
        await tx.conversationMessage.delete({ where: { id: holder.id } });
        if ((await tx.conversationMessage.count({ where: { conversationId: holder.conversationId } })) === 0) {
          await tx.conversation.delete({ where: { id: holder.conversationId } });
        }
      } else {
        await tx.conversationMessage.update({ where: { id: holder.id }, data: { externalId: null } });
      }
    }
    await tx.conversationMessage.update({ where: { id: messageId }, data: { externalId } });
  });
}
