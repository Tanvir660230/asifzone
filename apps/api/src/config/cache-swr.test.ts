import { describe, it, expect, afterAll } from "vitest";
import { cacheDel, cacheSwr, redis } from "./redis";

// Admin audit phase 5: heavy report endpoints (analytics, BI) took 2–3 s on every cold cache, and a page fires ten or
// more of them — the 8–22 s pages seen live. cacheSwr serves a stale answer at once and refreshes it in the background,
// so only the very first visit ever waits; concurrent first visits share one computation.

const RUN = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const keys: string[] = [];
const key = (k: string) => {
  const full = `swr-test:${RUN}:${k}`;
  keys.push(full);
  return full;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function reachable() {
  await redis.connect().catch(() => undefined);
  return redis.ping().then(() => true, () => false);
}

afterAll(async () => {
  await cacheDel(...keys);
});

describe("cacheSwr", () => {
  it("computes once on a miss and serves the cached value while fresh", async () => {
    if (!(await reachable())) return console.log("[swr test] Redis unreachable — skipped");
    const k = key("fresh");
    let calls = 0;
    const compute = async () => ({ n: ++calls });
    expect(await cacheSwr(k, { freshSeconds: 60, staleSeconds: 60 }, compute)).toEqual({ n: 1 });
    expect(await cacheSwr(k, { freshSeconds: 60, staleSeconds: 60 }, compute)).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  it("concurrent misses share one computation", async () => {
    if (!(await reachable())) return console.log("[swr test] Redis unreachable — skipped");
    const k = key("concurrent");
    let calls = 0;
    const compute = async () => {
      calls++;
      await sleep(50);
      return { n: calls };
    };
    const results = await Promise.all([1, 2, 3, 4].map(() => cacheSwr(k, { freshSeconds: 60, staleSeconds: 60 }, compute)));
    expect(results).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }, { n: 1 }]);
    expect(calls).toBe(1);
  });

  it("a stale value is served immediately while one background refresh replaces it", async () => {
    if (!(await reachable())) return console.log("[swr test] Redis unreachable — skipped");
    const k = key("stale");
    let calls = 0;
    const slow = async () => {
      calls++;
      await sleep(150);
      return { n: calls };
    };
    await cacheSwr(k, { freshSeconds: 1, staleSeconds: 60 }, slow);
    await sleep(1100); // now stale
    const t0 = Date.now();
    expect(await cacheSwr(k, { freshSeconds: 1, staleSeconds: 60 }, slow)).toEqual({ n: 1 });
    expect(Date.now() - t0).toBeLessThan(100); // didn't wait for the refresh
    expect(await cacheSwr(k, { freshSeconds: 1, staleSeconds: 60 }, slow)).toEqual({ n: 1 }); // one refresh, not two
    await sleep(250);
    expect(calls).toBe(2);
    expect(await cacheSwr(k, { freshSeconds: 1, staleSeconds: 60 }, slow)).toEqual({ n: 2 });
  });

  it("works without Redis (computes every time, never throws)", async () => {
    let calls = 0;
    const value = await cacheSwr(key("no-redis"), { freshSeconds: 60, staleSeconds: 60 }, async () => ({ n: ++calls }), { redisAvailable: () => false });
    expect(value).toEqual({ n: 1 });
  });
});
