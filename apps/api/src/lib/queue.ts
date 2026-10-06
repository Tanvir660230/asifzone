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

/** The one way to open a queue: this installation's prefix and the shared BullMQ connection. */
export function createQueue(name: string, opts: Omit<QueueOptions, "connection" | "prefix"> = {}): Queue {
  return new Queue(name, { ...opts, connection: queueConnection, prefix: QUEUE_PREFIX });
}
