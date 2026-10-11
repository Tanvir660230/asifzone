/**
 * Outbox delivery (Phase 8, docs/PHASE_8_AUDIT.md): durable intent + at-least-once delivery + idempotent consumers.
 *
 *   dispatchOutbox   claims due PENDING rows (FOR UPDATE SKIP LOCKED + a short lease, safe with any number of dispatchers),
 *                    enqueues each to BullMQ with a per-attempt job id (a duplicate enqueue of the same attempt is a no-op),
 *                    and marks it ENQUEUED only AFTER the enqueue succeeded. Redis down → the row stays PENDING.
 *   processOutboxEvent  claims one row (PENDING/ENQUEUED → PROCESSING, attempts + 1, lease) — a duplicate delivery finds it
 *                    PROCESSED or PROCESSING and does nothing — runs its consumer, then PROCESSED, or a retry with
 *                    exponential backoff, or FAILED (non-retryable / attempts exhausted).
 *   reapStaleClaims  returns rows whose worker lease expired (crash) or whose job vanished to PENDING.
 *
 * Retry/failure state lives in PostgreSQL (queryable, survives a Redis loss); BullMQ is the transport. Exactly-once external
 * delivery is NOT claimed — see each consumer's `idempotency`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { utcInstant } from "../metrics/store-time";
import { outboxConsumer, type OutboxConsumer } from "./consumers";
import { currentCorrelationId, newCorrelationId, runWithContext } from "../../lib/observability/context";
import { captureError } from "../../lib/observability/error-capture";
import { maskText } from "../../lib/observability/logger";

export const OUTBOX_MAX_ATTEMPTS = 8;
export const DISPATCH_LEASE_MS = 30_000;
export const PROCESS_LEASE_MS = 5 * 60_000;
/** An ENQUEUED row not picked up within this window lost its job (Redis flushed, job removed) and is dispatched again. */
export const ENQUEUED_STALE_MS = 15 * 60_000;
export const ENQUEUE_RETRY_MS = 10_000;
export const PROCESSED_RETENTION_DAYS = 30;
/** "Due" allows this much clock slack: timestamp(3) columns round to the millisecond, so a row written in the same instant
 * can read as marginally in the future. Backoffs start at 30 s, so this never lets a retry through early. */
export const DUE_TOLERANCE_MS = 1_000;
const HEARTBEAT_KEY = "outbox:dispatcher:heartbeat";

/** 30 s, 1 min, 2 min, … capped at 6 h — attempts 1..8 span ~1 h in total. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 6 * 3_600_000);
}

/** One BullMQ job per (event, attempt): re-enqueueing the same attempt is deduplicated by BullMQ. */
export function outboxJobId(eventId: string, attempts: number): string {
  return `outbox-${eventId}-${attempts}`;
}

/** A consumer error is retryable unless it says otherwise (`retryable: false` — SmsProviderError, MailProviderError,
 * MetaApiError) or is BullMQ's UnrecoverableError. */
export function isRetryable(err: unknown): boolean {
  if (err && typeof err === "object") {
    if ("retryable" in err) return Boolean((err as { retryable: unknown }).retryable);
    if ((err as { name?: unknown }).name === "UnrecoverableError") return false;
  }
  return true;
}

const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
// Masked before it is persisted (lastError is shown on /api/v1/outbox/status): Phase 12 W7.
const errorText = (err: unknown) => maskText(err instanceof Error ? err.message : String(err)).slice(0, 2000);

export type Enqueue = (job: { eventId: string; jobId: string }) => Promise<void>;

/** Claims due rows and hands each to `enqueue`; returns how many were claimed / enqueued / left for a later try. */
export async function dispatchOutbox(opts: {
  enqueue: Enqueue;
  limit?: number;
  now?: Date;
  /** Restrict to these rows (an operator re-drive, or a test isolating its own rows); omitted = every due row. */
  onlyIds?: string[];
}): Promise<{ claimed: number; enqueued: number; deferred: number }> {
  const now = opts.now ?? new Date();
  const scope = opts.onlyIds ? Prisma.sql`AND id IN (${Prisma.join(opts.onlyIds.length ? opts.onlyIds : [""])})` : Prisma.empty;
  const claimed = await prisma.$queryRaw<Array<{ id: string; attempts: number }>>`
    UPDATE "OutboxEvent"
    SET "claimedUntil" = ${utcInstant(plus(now, DISPATCH_LEASE_MS))}, "updatedAt" = ${utcInstant(now)}
    WHERE id IN (
      SELECT id FROM "OutboxEvent"
      WHERE status = 'PENDING' AND "availableAt" <= ${utcInstant(plus(now, DUE_TOLERANCE_MS))} AND ("claimedUntil" IS NULL OR "claimedUntil" < ${utcInstant(now)}) ${scope}
      ORDER BY "availableAt" ASC
      LIMIT ${opts.limit ?? 100}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, attempts`;

  let enqueued = 0;
  let deferred = 0;
  for (const row of claimed) {
    try {
      await opts.enqueue({ eventId: row.id, jobId: outboxJobId(row.id, row.attempts) });
    } catch (err) {
      // Redis unavailable / enqueue failed: release the claim and try again shortly — nothing is lost.
      await prisma.outboxEvent.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: { claimedUntil: null, availableAt: plus(now, ENQUEUE_RETRY_MS), lastError: `enqueue failed: ${errorText(err)}` },
      });
      deferred++;
      continue;
    }
    // Only now is it ENQUEUED. A worker may already have claimed it (status PROCESSING/PROCESSED) — then this is a no-op.
    await prisma.outboxEvent.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "ENQUEUED", enqueuedAt: now, claimedUntil: null } });
    enqueued++;
  }
  return { claimed: claimed.length, enqueued, deferred };
}

/** Rows a crashed worker left PROCESSING past its lease, and ENQUEUED rows whose job never ran, go back to PENDING. */
export async function reapStaleClaims(now: Date = new Date()): Promise<{ processing: number; enqueued: number }> {
  const processing = await prisma.outboxEvent.updateMany({
    where: { status: "PROCESSING", claimedUntil: { lt: now } },
    data: { status: "PENDING", claimedUntil: null, lastError: "worker lease expired before completion" },
  });
  const enqueued = await prisma.outboxEvent.updateMany({
    where: { status: "ENQUEUED", enqueuedAt: { lt: new Date(now.getTime() - ENQUEUED_STALE_MS) } },
    data: { status: "PENDING", claimedUntil: null },
  });
  return { processing: processing.count, enqueued: enqueued.count };
}

export type ProcessOutcome = { outcome: "skipped" } | { outcome: "processed"; result: string } | { outcome: "retry"; attempts: number; availableAt: Date; error: string } | { outcome: "failed"; attempts: number; error: string };

/** Delivers one outbox event (called by the BullMQ worker). Safe to call any number of times for the same id. */
export async function processOutboxEvent(eventId: string, opts: { now?: Date; consumers?: Record<string, OutboxConsumer> } = {}): Promise<ProcessOutcome> {
  const now = opts.now ?? new Date();
  const [row] = await prisma.$queryRaw<Array<{ id: string; eventType: string; consumer: string; eventKey: string; payload: unknown; attempts: number; correlationId: string | null }>>`
    UPDATE "OutboxEvent"
    SET status = 'PROCESSING', attempts = attempts + 1, "claimedUntil" = ${utcInstant(plus(now, PROCESS_LEASE_MS))}, "updatedAt" = ${utcInstant(now)}
    WHERE id = ${eventId} AND status IN ('PENDING', 'ENQUEUED') AND "availableAt" <= ${utcInstant(plus(now, DUE_TOLERANCE_MS))}
    RETURNING id, "eventType", consumer, "eventKey", payload, attempts, "correlationId"`;
  if (!row) return { outcome: "skipped" }; // already processed/processing, failed, not due yet, or gone

  const fail = async (error: string): Promise<ProcessOutcome> => {
    await prisma.outboxEvent.updateMany({ where: { id: row.id, status: "PROCESSING" }, data: { status: "FAILED", claimedUntil: null, lastError: error } });
    return { outcome: "failed", attempts: row.attempts, error };
  };

  const consumer = opts.consumers ? opts.consumers[row.consumer] : outboxConsumer(row.consumer);
  if (!consumer) return fail(`unsupported consumer "${row.consumer}"`);
  if (!consumer.eventTypes.includes(row.eventType)) return fail(`${row.consumer} doesn't accept event ${row.eventType}`);
  const parsed = consumer.payload.safeParse(row.payload);
  if (!parsed.success) return fail(`invalid payload: ${parsed.error.message}`.slice(0, 2000));

  let result: string;
  // Phase 11: the consumer (and every provider call it makes) runs in the recording request's correlation context.
  const ctx = { correlationId: row.correlationId ?? currentCorrelationId() ?? newCorrelationId(), operation: `outbox:${row.consumer}` };
  try {
    result = await runWithContext(ctx, () => consumer.handle(parsed.data, { id: row.id, eventKey: row.eventKey }));
  } catch (err) {
    runWithContext(ctx, () => captureError(err, { outboxEventId: row.id, consumer: row.consumer, attempt: row.attempts }));
    const error = errorText(err);
    if (!isRetryable(err)) return fail(`non-retryable: ${error}`);
    if (row.attempts >= OUTBOX_MAX_ATTEMPTS) return fail(`gave up after ${row.attempts} attempts: ${error}`);
    const availableAt = plus(now, retryDelayMs(row.attempts));
    await prisma.outboxEvent.updateMany({ where: { id: row.id, status: "PROCESSING" }, data: { status: "PENDING", claimedUntil: null, availableAt, lastError: error } });
    return { outcome: "retry", attempts: row.attempts, availableAt, error };
  }

  await prisma.outboxEvent.updateMany({
    where: { id: row.id, status: "PROCESSING" },
    data: {
      status: "PROCESSED",
      processedAt: now,
      claimedUntil: null,
      lastError: null,
      ...(consumer.scrub ? { payload: consumer.scrub(parsed.data) as Prisma.InputJsonValue } : {}),
    },
  });
  return { outcome: "processed", result };
}

/** Retention: processed rows are kept for PROCESSED_RETENTION_DAYS for audit/debugging, then deleted. FAILED rows are never
 * deleted automatically — they stay visible until an operator retries them. */
export async function cleanupOutbox(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PROCESSED_RETENTION_DAYS * 86_400_000);
  return (await prisma.outboxEvent.deleteMany({ where: { status: "PROCESSED", processedAt: { lt: cutoff } } })).count;
}

/** Operator action: send a FAILED event round again (attempts reset). */
export async function retryOutboxEvent(eventId: string, now: Date = new Date()): Promise<boolean> {
  const res = await prisma.outboxEvent.updateMany({ where: { id: eventId, status: "FAILED" }, data: { status: "PENDING", attempts: 0, availableAt: now, claimedUntil: null } });
  return res.count === 1;
}

export async function markDispatcherHeartbeat(at: Date = new Date()): Promise<void> {
  await cacheSet(HEARTBEAT_KEY, { at: at.toISOString() }, 3_600);
}

/** Phase 11 readiness: only the dispatcher heartbeat (cheap), same 60 s rule as outboxStatus().dispatcher.healthy. */
export async function dispatcherHealthy(now: Date = new Date()): Promise<boolean> {
  const heartbeat = await cacheGet<{ at: string }>(HEARTBEAT_KEY);
  return heartbeat !== null && now.getTime() - new Date(heartbeat.at).getTime() < 60_000;
}

/** Operational visibility: counts, the oldest undelivered intent, recent failures, dispatcher heartbeat. */
export async function outboxStatus(now: Date = new Date()) {
  const [groups, oldestPending, oldestFailed, failures, heartbeat] = await Promise.all([
    prisma.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.outboxEvent.findFirst({ where: { status: { in: ["PENDING", "ENQUEUED", "PROCESSING"] } }, orderBy: { createdAt: "asc" }, select: { id: true, eventType: true, consumer: true, createdAt: true, attempts: true, lastError: true } }),
    prisma.outboxEvent.findFirst({ where: { status: "FAILED" }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true } }),
    prisma.outboxEvent.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, eventType: true, consumer: true, eventKey: true, aggregateType: true, aggregateId: true, attempts: true, lastError: true, createdAt: true, updatedAt: true },
    }),
    cacheGet<{ at: string }>(HEARTBEAT_KEY),
  ]);
  const counts = Object.fromEntries(["PENDING", "ENQUEUED", "PROCESSING", "PROCESSED", "FAILED"].map((s) => [s, groups.find((g) => g.status === s)?._count._all ?? 0]));
  const lastRun = heartbeat ? new Date(heartbeat.at) : null;
  return {
    counts,
    undelivered: counts.PENDING! + counts.ENQUEUED! + counts.PROCESSING!,
    oldestUndelivered: oldestPending ? { ...oldestPending, ageSeconds: Math.round((now.getTime() - oldestPending.createdAt.getTime()) / 1000) } : null,
    oldestFailedAgeSeconds: oldestFailed ? Math.round((now.getTime() - oldestFailed.createdAt.getTime()) / 1000) : null,
    recentFailures: failures,
    dispatcher: { lastRunAt: lastRun?.toISOString() ?? null, healthy: lastRun !== null && now.getTime() - lastRun.getTime() < 60_000 },
  };
}
