import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { recordOutboxEvents } from "../../domain/outbox/outbox";
import type { InboundEvent } from "./meta-webhook.parse";

/** Outbox consumer that lets the AI read each new customer message (Social Inbox). */
export const ASSIST_CONSUMER = "conversation-assist" as const;

const SUBJECT: Record<InboundEvent["channel"], string> = {
  WHATSAPP: "WhatsApp chat",
  MESSENGER: "Messenger chat",
  INSTAGRAM: "Instagram DM",
  FB_COMMENT: "Comment on a post",
};

/** Shown until the real name is known (Messenger / Instagram webhooks carry only an id; the assist step looks it up). */
export const PLACEHOLDER_NAME: Record<InboundEvent["channel"], string> = {
  WHATSAPP: "WhatsApp customer",
  MESSENGER: "Messenger customer",
  INSTAGRAM: "Instagram customer",
  FB_COMMENT: "Facebook user",
};

const OWN_ECHO_WINDOW_MS = 10 * 60_000;

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/**
 * Stores what a Meta webhook delivered. A customer message (IN) opens or reopens its conversation and asks the AI to
 * look at it (outbox `conversation-assist`, eventKey = the message id). A reply staff sent from the phone app or the Page
 * inbox (OUT echo) is recorded as author PHONE and closes the thread. Meta re-delivers webhooks, so a message whose
 * `externalId` is already stored is skipped — including the echo of a reply this store sent itself.
 * Returns the ids of the messages created.
 */
export async function ingestInbound(events: InboundEvent[]): Promise<string[]> {
  const created: string[] = [];
  for (const event of events) {
    // Two deliveries of the same webhook can race: the loser hits a unique index and is simply a duplicate. A thread
    // created concurrently by another message is found on the retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const id = await ingestOne(event);
        if (id) created.push(id);
        break;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
  }
  return created;
}

async function ingestOne(event: InboundEvent): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    if (await tx.conversationMessage.findUnique({ where: { externalId: event.externalId }, select: { id: true } })) return null;

    const where = { channel_externalThreadId: { channel: event.channel, externalThreadId: event.threadId } };
    const existing = await tx.conversation.findUnique({ where, select: { id: true, contactName: true, lastInboundAt: true } });
    const inbound = event.direction === "IN";
    const name = event.name?.trim() || null;

    // Meta can echo a reply we sent before the sender has saved Meta's id for it: the same text, sent from here in the
    // last few minutes and still without an id, is that reply — claim the id instead of adding a "from the phone" copy.
    if (!inbound && existing) {
      const ours = await tx.conversationMessage.findFirst({
        where: {
          conversationId: existing.id,
          direction: "OUT",
          author: { in: ["STAFF", "AI"] },
          externalId: null,
          body: event.body,
          createdAt: { gte: new Date(event.at.getTime() - OWN_ECHO_WINDOW_MS) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (ours) {
        await tx.conversationMessage.update({ where: { id: ours.id }, data: { externalId: event.externalId } });
        return null;
      }
    }

    let conversationId: string;
    if (existing) {
      conversationId = existing.id;
      await tx.conversation.update({
        where: { id: existing.id },
        data: {
          status: inbound ? "OPEN" : "HANDLED",
          lastMessageAt: event.at,
          ...(inbound && (!existing.lastInboundAt || existing.lastInboundAt < event.at) ? { lastInboundAt: event.at } : {}),
          ...(name && existing.contactName === PLACEHOLDER_NAME[event.channel] ? { contactName: name } : {}),
        },
      });
    } else {
      // WhatsApp proves the number, but the store still links only a customer who verified that phone with us.
      const customer = event.phone
        ? await tx.customer.findFirst({ where: { phone: event.phone, phoneVerifiedAt: { not: null } }, select: { id: true } })
        : null;
      conversationId = (
        await tx.conversation.create({
          data: {
            channel: event.channel,
            externalThreadId: event.threadId,
            subject: SUBJECT[event.channel],
            contactName: (inbound && name) || PLACEHOLDER_NAME[event.channel],
            phone: event.phone,
            customerId: customer?.id ?? null,
            status: inbound ? "OPEN" : "HANDLED",
            lastMessageAt: event.at,
            lastInboundAt: inbound ? event.at : null,
            postId: event.postId ?? null,
            createdAt: event.at,
          },
          select: { id: true },
        })
      ).id;
    }

    const message = await tx.conversationMessage.create({
      data: {
        conversationId,
        direction: event.direction,
        channel: event.channel,
        body: event.body,
        author: inbound ? "CUSTOMER" : "PHONE",
        externalId: event.externalId,
        createdAt: event.at,
      },
      select: { id: true },
    });

    if (inbound) {
      await recordOutboxEvents(tx, [
        {
          eventType: "conversation.inbound_received.v1",
          consumer: ASSIST_CONSUMER,
          eventKey: message.id,
          aggregateType: "conversation",
          aggregateId: conversationId,
          payload: { messageId: message.id },
        },
      ]);
    } else {
      // Someone answered from the phone: an AI draft for the earlier question is stale.
      await tx.conversationDraft.deleteMany({ where: { conversationId } });
    }
    return message.id;
  });
}
