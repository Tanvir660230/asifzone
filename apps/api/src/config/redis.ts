import Redis from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  // Without this, ioredis queues commands while disconnected instead of failing them —
  // so every cache call would silently stall for seconds whenever Redis is unreachable.
  enableOfflineQueue: false,
  retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
});

let loggedConnectionError = false;
redis.on("error", (err) => {
  if (!loggedConnectionError) {
    console.error("[redis] connection error (further errors suppressed):", err.message);
    loggedConnectionError = true;
  }
});
redis.on("connect", () => {
  loggedConnectionError = false;
});

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // cache is best-effort; failures should never break a request
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await redis.del(...keys);
  } catch {
    // best-effort
  }
}

export async function cacheDelByPrefix(prefix: string): Promise<void> {
  try {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
  } catch {
    // best-effort
  }
}
