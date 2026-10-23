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
  const failures: unknown[] = [];
  for (const event of events) {
    // Two deliveries of the same webhook can race: the loser hits a unique index and is simply a duplicate. A thread
    // created concurrently by another message is found on the retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const id = await ingestOne(event);
        if (id) created.push(id);
        break;
      } catch (err) {
        if (isUniqueViolation(err) && attempt === 0) continue;
        if (!isUniqueViolation(err)) failures.push(err); // one bad event doesn't stop the rest of the batch
        break;
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length} of ${events.length} webhook events were not stored`);
  return created;
}

/**
 * Old messages imported once (WhatsApp history sync, Messenger / Instagram import): stored in bulk per thread, each
 * message once (Meta's id). They give staff and the AI the conversation so far, but a thread they create starts as
 * handled, an existing thread keeps its status, and no AI job is queued. Returns how many messages were new.
 */
export async function ingestHistory(events: InboundEvent[]): Promise<number> {
  const threads = new Map<string, InboundEvent[]>();
  for (const e of events) {
    const key = `${e.channel}\u0000${e.threadId}`;
    threads.set(key, [...(threads.get(key) ?? []), e]);
  }
  let stored = 0;
  for (const list of threads.values()) {
    const first = list[0]!;
    const times = list.map((e) => e.at.getTime());
    const inbound = list.filter((e) => e.direction === "IN").map((e) => e.at.getTime());
    const lastAt = new Date(Math.max(...times));
    const lastIn = inbound.length ? new Date(Math.max(...inbound)) : null;
    const name = list.find((e) => e.direction === "IN" && e.name)?.name ?? null;
    stored += await prisma.$transaction(async (tx) => {
      const where = { channel_externalThreadId: { channel: first.channel, externalThreadId: first.threadId } };
      const existing = await tx.conversation.findUnique({ where, select: { id: true, lastMessageAt: true, lastInboundAt: true, contactName: true } });
      let conversationId: string;
      if (existing) {
        conversationId = existing.id;
        await tx.conversation.update({
          where: { id: existing.id },
          data: {
            ...(lastAt > existing.lastMessageAt ? { lastMessageAt: lastAt } : {}),
            ...(lastIn && (!existing.lastInboundAt || lastIn > existing.lastInboundAt) ? { lastInboundAt: lastIn } : {}),
            ...(name && existing.contactName === PLACEHOLDER_NAME[first.channel] ? { contactName: name } : {}),
          },
        });
      } else {
        const customer = first.phone
          ? await tx.customer.findFirst({ where: { phone: first.phone, phoneVerifiedAt: { not: null } }, select: { id: true } })
          : null;
        conversationId = (
          await tx.conversation.create({
            data: {
              channel: first.channel,
              externalThreadId: first.threadId,
              subject: SUBJECT[first.channel],
              contactName: name ?? PLACEHOLDER_NAME[first.channel],
              phone: first.phone,
              customerId: customer?.id ?? null,
              status: "HANDLED",
              lastMessageAt: lastAt,
              lastInboundAt: lastIn,
              postId: first.postId ?? null,
              createdAt: new Date(Math.min(...times)),
            },
            select: { id: true },
          })
        ).id;
      }
      const { count } = await tx.conversationMessage.createMany({
        data: list.map((e) => ({
          conversationId,
          direction: e.direction,
          channel: e.channel,
          body: e.body,
          author: e.direction === "IN" ? ("CUSTOMER" as const) : ("PHONE" as const),
          externalId: e.externalId,
          createdAt: e.at,
        })),
        skipDuplicates: true,
      });
      return count;
    });
  }
  return stored;
}

async function ingestOne(event: InboundEvent): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    if (await tx.conversationMessage.findUnique({ where: { externalId: event.externalId }, select: { id: true } })) return null;

    const where = { channel_externalThreadId: { channel: event.channel, externalThreadId: event.threadId } };
    const existing = await tx.conversation.findUnique({ where, select: { id: true, contactName: true, lastInboundAt: true, lastMessageAt: true } });
    const inbound = event.direction === "IN";
    const name = event.name?.trim() || null;
    // Webhooks can arrive out of order: a delayed phone reply must not close a thread the customer has written in since.
    const answersLatest = !inbound && (!existing?.lastInboundAt || event.at >= existing.lastInboundAt);

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
        // Echoes come in send order, so two identical queued replies are claimed oldest first.
        orderBy: { createdAt: "asc" },
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
          ...(inbound ? { status: "OPEN" as const } : answersLatest ? { status: "HANDLED" as const } : {}),
          ...(event.at > existing.lastMessageAt ? { lastMessageAt: event.at } : {}),
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
    } else if (answersLatest) {
      // Someone answered the latest question from the phone: an AI draft for it is stale.
      await tx.conversationDraft.deleteMany({ where: { conversationId } });
    }
    return message.id;
  });
}
