import Redis from "ioredis";
import { env } from "./env";
import { namespace } from "./installation";
import { logger } from "../lib/observability/logger";

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
    logger.error("[redis] connection error (further errors suppressed):", { detail: err.message });
    loggedConnectionError = true;
  }
});
redis.on("connect", () => {
  loggedConnectionError = false;
});

// Phase 1C: every cache entry lives under this installation's namespace (`install:<id>:cache:<key>`), so installations
// sharing one Redis server never read, overwrite or bust each other's entries. Callers keep passing their logical keys.

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(namespace.cache(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
  try {
    await redis.set(namespace.cache(key), JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // cache is best-effort; failures should never break a request
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await redis.del(...keys.map(namespace.cache));
  } catch {
    // best-effort
  }
}

/** SCAN, not KEYS — KEYS walks the entire keyspace in one blocking call, which stalls every other
 * Redis client (this cache is shared by every module) for however long that takes; SCAN does the
 * same walk in small non-blocking increments via a cursor. Cost is the same either way, but SCAN
 * doesn't freeze the server while paying it. */
export async function cacheDelByPrefix(prefix: string): Promise<void> {
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${namespace.cache(prefix)}*`, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    // best-effort
  }
}

interface SwrEnvelope<T> {
  v: T;
  /** When the value was computed (epoch ms). */
  at: number;
}
/** Computations in flight in this process, by key — concurrent callers share one. */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Stale-while-revalidate (admin audit phase 5) for heavy, read-only reports. A value younger than `freshSeconds` is
 * served as is; an older one (up to `freshSeconds + staleSeconds`) is served at once while ONE background refresh
 * replaces it (a short Redis lock keeps two processes from both refreshing); a miss computes, and concurrent misses in
 * this process share that computation. Only the very first visit ever waits. Without Redis it simply computes.
 * Not for figures someone acts on and expects to change the moment they fix something (finance alerts) — use plain
 * cacheGet / cacheSet there.
 */
export async function cacheSwr<T>(
  key: string,
  { freshSeconds, staleSeconds }: { freshSeconds: number; staleSeconds: number },
  compute: () => Promise<T>,
  opts: { redisAvailable?: () => boolean } = {},
): Promise<T> {
  const computeAndStore = (): Promise<T> => {
    const running = inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = (async () => {
      try {
        const v = await compute();
        if (opts.redisAvailable?.() !== false) await cacheSet(`swr:${key}`, { v, at: Date.now() } satisfies SwrEnvelope<T>, freshSeconds + staleSeconds);
        return v;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, p);
    return p;
  };

  if (opts.redisAvailable?.() === false) return compute();
  const hit = await cacheGet<SwrEnvelope<T>>(`swr:${key}`);
  if (!hit) return computeAndStore();
  if (Date.now() - hit.at > freshSeconds * 1000 && !inFlight.has(key)) {
    // One refresher across processes: whoever takes the lock refreshes; everyone keeps serving the stale value.
    const locked = await redis.set(namespace.cache(`swr-lock:${key}`), "1", "EX", 30, "NX").catch(() => null);
    if (locked === "OK") {
      void computeAndStore()
        .catch((err) => logger.error("[cache] background refresh failed", { key, detail: err instanceof Error ? err.message : String(err) }))
        .finally(() => void redis.del(namespace.cache(`swr-lock:${key}`)).catch(() => undefined));
    }
  }
  return hit.v;
}
