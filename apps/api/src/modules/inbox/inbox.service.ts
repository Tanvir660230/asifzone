import type { Prisma } from "@prisma/client";
import {
  normalizeBdPhone,
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
  }));
  return { ...page, items };
}

function deliveryOf(status: string | undefined): MessageDelivery {
  if (status === "PROCESSED") return "sent";
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
    const delivery = m.direction === "OUT" ? deliveryOf(event?.status) : null;
    return {
      id: m.id,
      direction: m.direction,
      channel: m.channel,
      body: m.body,
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
  };
}

/** Records a reply and its send intent in one transaction; replying marks the conversation handled. */
export async function replyToConversation(id: string, input: ConversationReplyInput, adminId: string): Promise<ConversationMessageRow> {
  const message = await prisma.$transaction(async (tx) => {
    const c = await tx.conversation.findUnique({ where: { id }, select: { id: true, email: true, phone: true } });
    if (!c) throw AppError.notFound("Conversation not found");
    if (input.channel === "EMAIL" && !c.email) throw AppError.badRequest("This customer left no email address — reply by SMS", { code: "NO_EMAIL" });
    if (input.channel === "SMS" && !c.phone) throw AppError.badRequest("This customer left no phone number — reply by email", { code: "NO_PHONE" });
    const m = await tx.conversationMessage.create({
      data: { conversationId: id, direction: "OUT", channel: input.channel, body: input.body, adminId },
      include: { admin: { select: { name: true } } },
    });
    await tx.conversation.update({ where: { id }, data: { status: "HANDLED", lastMessageAt: m.createdAt } });
    await recordOutboxEvents(tx, [
      { eventType: "conversation.reply_requested.v1", consumer: REPLY_CONSUMER, eventKey: m.id, aggregateType: "conversation", aggregateId: id, payload: { messageId: m.id } },
    ]);
    return m;
  });
  return {
    id: message.id,
    direction: "OUT",
    channel: message.channel,
    body: message.body,
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

export async function deleteConversation(id: string) {
  const deleted = await prisma.conversation.deleteMany({ where: { id } });
  if (deleted.count === 0) throw AppError.notFound("Conversation not found");
}

/** Open conversations — the Messages badge (attention composite). */
export function countOpenConversations() {
  return prisma.conversation.count({ where: { status: "OPEN" } });
}

/** What the `conversation-reply` consumer needs at send time (read, never written). */
export function replyFacts(messageId: string) {
  return prisma.conversationMessage.findUnique({
    where: { id: messageId },
    select: { body: true, channel: true, direction: true, conversation: { select: { subject: true, contactName: true, email: true, phone: true } } },
  });
}
