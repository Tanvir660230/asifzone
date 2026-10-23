import { randomUUID } from "node:crypto";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { recordOutboxEvents } from "../../domain/outbox/outbox";
import { getProviders } from "../../providers/registry";
import type { PageConversation } from "../../providers/social/meta-graph";
import { ingestHistory } from "./ingest.service";
import type { InboundEvent } from "./meta-webhook.parse";

export const HISTORY_IMPORT_CONSUMER = "meta-history-import" as const;
export const HISTORY_IMPORT_MAX_DAYS = 90;

/** Turns the Page's past conversations into historical Inbox events. The customer is the participant who isn't the
 * Page / Instagram account; a message from the store's side is a staff reply sent outside the Inbox. */
export function conversationsToEvents(channel: "MESSENGER" | "INSTAGRAM", conversations: PageConversation[], ownIds: string[]): InboundEvent[] {
  const own = new Set(ownIds.filter(Boolean));
  const events: InboundEvent[] = [];
  for (const c of conversations) {
    const customer = c.participants.find((p) => !own.has(p.id));
    if (!customer) continue;
    for (const m of c.messages) {
      const body = m.text ?? (m.hasAttachment ? "[Attachment]" : null);
      if (!body) continue;
      const inbound = m.fromId === customer.id;
      events.push({
        channel,
        direction: inbound ? "IN" : "OUT",
        threadId: customer.id,
        externalId: m.id,
        name: inbound ? customer.name : null,
        phone: null,
        body,
        at: new Date(m.createdTime),
        historical: true,
      });
    }
  }
  return events;
}

/** Queues an import (Settings › Integrations › Import past chats). Needs the Page connection. */
export async function requestPastChatsImport(days: number): Promise<void> {
  if (!env.metaInbox.pageId || !env.metaInbox.pageAccessToken) {
    throw AppError.badRequest("Save the Facebook Page ID and Page access token first.", { code: "PAGE_NOT_CONNECTED" });
  }
  await prisma.$transaction((tx) =>
    recordOutboxEvents(tx, [
      {
        eventType: "meta.history_import_requested.v1",
        consumer: HISTORY_IMPORT_CONSUMER,
        eventKey: `import-${randomUUID()}`,
        aggregateType: "settings",
        aggregateId: "meta-history-import",
        payload: { days },
      },
    ]),
  );
}

/** Outbox consumer `meta-history-import`: copies the last `days` of Messenger (and, when connected, Instagram) chats into
 * the Inbox. Idempotent — every message is stored once by Meta's id, so running it again only adds what's new. */
export async function importPastChats(days: number, now: Date = new Date()): Promise<{ messenger: number; instagram: number }> {
  const since = new Date(now.getTime() - Math.min(days, HISTORY_IMPORT_MAX_DAYS) * 24 * 3_600_000);
  const social = getProviders().social;
  const { pageId, igAccountId } = env.metaInbox;
  const messenger = await ingestHistory(conversationsToEvents("MESSENGER", await social.pageConversations("messenger", since), [pageId]));
  const instagram = igAccountId
    ? await ingestHistory(conversationsToEvents("INSTAGRAM", await social.pageConversations("instagram", since), [pageId, igAccountId]))
    : 0;
  return { messenger, instagram };
}
