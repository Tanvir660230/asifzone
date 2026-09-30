/**
 * The transactional outbox writer (Phase 8, docs/PHASE_8_AUDIT.md) — the ONLY code that creates OutboxEvent rows. It takes
 * a TRANSACTION client, so an intent can only be recorded inside the business transaction it follows: if that commits,
 * the intent is durable; if it rolls back, no intent exists; if recording the intent fails, the business change rolls back.
 */
import type { Prisma } from "@prisma/client";
import type { AppTransactionClient } from "../../config/prisma";
import { outboxConsumer, type OutboxConsumerName } from "./consumers";

export interface OutboxIntent {
  /** Versioned business event, e.g. "order.placed.v1". */
  eventType: string;
  consumer: OutboxConsumerName;
  /** Business idempotency key — one intent per (consumer, eventKey); a repeat is ignored. */
  eventKey: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/** Records side-effect intents in the caller's transaction. Throws (rolling the transaction back) for an unknown
 * consumer, an event type/version the consumer doesn't accept, or a payload that doesn't match its schema. */
export async function recordOutboxEvents(tx: AppTransactionClient, intents: OutboxIntent[]): Promise<void> {
  if (!intents.length) return;
  for (const intent of intents) {
    const consumer = outboxConsumer(intent.consumer);
    if (!consumer) throw new Error(`[outbox] unknown consumer "${intent.consumer}"`);
    if (!consumer.eventTypes.includes(intent.eventType)) throw new Error(`[outbox] ${intent.consumer} doesn't accept ${intent.eventType}`);
    const parsed = consumer.payload.safeParse(intent.payload);
    if (!parsed.success) throw new Error(`[outbox] invalid ${intent.eventType} payload for ${intent.consumer}: ${parsed.error.message}`);
  }
  await tx.outboxEvent.createMany({
    data: intents.map((i) => ({ ...i, payload: i.payload as Prisma.InputJsonValue })),
    skipDuplicates: true,
  });
}
