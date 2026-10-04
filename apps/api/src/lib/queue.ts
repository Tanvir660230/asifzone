import IORedis from "ioredis";
import { env } from "../config/env";
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
