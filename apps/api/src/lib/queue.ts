import IORedis from "ioredis";
import { Queue, type QueueOptions } from "bullmq";
import { env } from "../config/env";
import { namespace } from "../config/installation";
import { logger } from "./observability/logger";

// BullMQ needs its own Redis connection: it issues blocking commands and manages its own
// retry/backoff, which conflicts with config/redis.ts's cache connection (enableOfflineQueue:
// false, maxRetriesPerRequest: 1) tuned for cache calls to fail fast instead of blocking a request.
export const queueConnection = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: null,
  connectTimeout: 2000,
  retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
});

queueConnection.on("error", (err) => {
  logger.error("[queue] redis connection error:", { detail: err.message });
});

/** Phase 1C: every BullMQ queue and worker of this installation uses this prefix (`install:<id>:bull`), so installations
 * sharing one Redis server never consume each other's jobs or collide on queue names, job ids or repeatable schedules. */
export const QUEUE_PREFIX = namespace.queuePrefix;

/** How long finished jobs stay in Redis. BullMQ keeps them forever by default, so every cron run piled up (2026-10-25:
 * ~0.7–0.8 GB per store's Redis on a 3.8 GB VPS, and the deploy build ran out of memory). A day / the last 200 completed
 * and a week / the last 1,000 failed is enough to look back on; a queue's own options still win. */
export const JOB_RETENTION = {
  removeOnComplete: { age: 24 * 60 * 60, count: 200 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
} as const;

/** Removes finished jobs older than the retention that piled up before it existed (BullMQ's retention only applies to
 * jobs finishing from now on). Batches of 1,000 until none are left; returns how many it removed. */
export async function trimFinishedJobs(queue: Queue, opts: { completedGraceMs?: number; failedGraceMs?: number } = {}): Promise<number> {
  const completedGrace = opts.completedGraceMs ?? JOB_RETENTION.removeOnComplete.age * 1000;
  const failedGrace = opts.failedGraceMs ?? JOB_RETENTION.removeOnFail.age * 1000;
  let removed = 0;
  for (const [grace, kind] of [[completedGrace, "completed"], [failedGrace, "failed"]] as const) {
    for (let round = 0; round < 1000; round++) {
      const ids = await queue.clean(grace, 1000, kind);
      removed += ids.length;
      if (ids.length < 1000) break;
    }
  }
  return removed;
}

const trimmed = new Set<string>();

/** The one way to open a queue: this installation's prefix, the shared BullMQ connection, and the job retention (which
 * job schedulers inherit too). The first time a queue is opened in a process, what piled up before is trimmed. */
export function createQueue(name: string, opts: Omit<QueueOptions, "connection" | "prefix"> = {}): Queue {
  const queue = new Queue(name, { ...opts, defaultJobOptions: { ...JOB_RETENTION, ...opts.defaultJobOptions }, connection: queueConnection, prefix: QUEUE_PREFIX });
  if (!trimmed.has(name)) {
    trimmed.add(name);
    void trimFinishedJobs(queue)
      .then((n) => { if (n > 0) logger.info(`[queue] removed ${n} old finished job(s) from ${name}`); })
      .catch((err: unknown) => logger.error("[queue] couldn't trim old jobs", { detail: `${name}: ${err instanceof Error ? err.message : String(err)}` }));
  }
  return queue;
}
