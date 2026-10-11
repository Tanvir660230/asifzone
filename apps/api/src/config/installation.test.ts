import { afterAll, describe, expect, it } from "vitest";
import { InvalidInstallIdError, assertInstallId, installationNamespace, resolveInstallId } from "@clothing-brand/shared";
import { installId, namespace } from "./installation";
import { cacheDel, cacheGet, cacheSet, redis } from "./redis";
import { QUEUE_PREFIX, createQueue, queueConnection } from "../lib/queue";

// Phase 1C: one installation id → one namespace for every Redis-backed subsystem.

describe("installation namespace", () => {
  const a = installationNamespace("asifzone");
  const b = installationNamespace("client-b");

  it("keeps two installations apart for cache keys, locks, queues and cache tags", () => {
    expect(a.cache("settings:singleton")).toBe("install:asifzone:cache:settings:singleton");
    expect(b.cache("settings:singleton")).toBe("install:client-b:cache:settings:singleton");
    expect(a.cache("x")).not.toBe(b.cache("x"));
    expect(a.lock("order-idem:k1")).not.toBe(b.lock("order-idem:k1"));
    expect(a.queuePrefix).toBe("install:asifzone:bull");
    expect(a.queuePrefix).not.toBe(b.queuePrefix);
    expect(a.cacheTag("products:listing")).toBe("install:asifzone:products:listing");
    expect(a.cacheTag("settings")).not.toBe(b.cacheTag("settings"));
  });

  it("never lets one installation's keys sit inside another's prefix", () => {
    // "client" must not be able to SCAN/DEL "client-b"'s keys with its own prefix.
    const c = installationNamespace("client");
    expect(b.cache("k").startsWith(c.root)).toBe(false);
  });

  it("accepts only safe installation ids", () => {
    for (const ok of ["asifzone", "client-b", "a1", "store-2026"]) expect(assertInstallId(ok)).toBe(ok);
    for (const bad of ["", "Asif", "has space", "a:b", "-lead", "a*", "x".repeat(64)]) {
      expect(() => assertInstallId(bad)).toThrow(InvalidInstallIdError);
    }
  });

  it("requires INSTALL_ID in production and defaults it elsewhere", () => {
    expect(() => resolveInstallId({ NODE_ENV: "production" })).toThrow(/INSTALL_ID/);
    expect(resolveInstallId({ NODE_ENV: "production", INSTALL_ID: "acme" })).toBe("acme");
    expect(resolveInstallId({ NODE_ENV: "development" })).toBe("local");
    expect(resolveInstallId({ NODE_ENV: "test" })).toBe("test");
  });

  it("is what this process uses", () => {
    expect(installId).toBe("test");
    expect(namespace.root).toBe("install:test:");
    expect(QUEUE_PREFIX).toBe("install:test:bull");
  });
});

describe("installation namespace against Redis", () => {
  const RUN = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  afterAll(async () => {
    await cacheDel(`phase1:${RUN}`);
    await redis.del(installationNamespace("other-store").cache(`phase1:${RUN}`)).catch(() => undefined);
  });

  async function reachable(): Promise<boolean> {
    await redis.connect().catch(() => undefined);
    return redis.ping().then(() => true, () => false);
  }

  it("stores cache entries under this installation only — another installation's entry is invisible", async () => {
    if (!(await reachable())) return console.log("[phase1 test] Redis unreachable — skipped");
    await cacheSet(`phase1:${RUN}`, { from: "test" }, 60);
    expect(await redis.get(`install:test:cache:phase1:${RUN}`)).toBe(JSON.stringify({ from: "test" }));
    expect(await redis.get(`phase1:${RUN}`)).toBeNull();

    // Same logical key written by another installation sharing the server: not ours to read.
    await redis.set(installationNamespace("other-store").cache(`phase1:${RUN}`), JSON.stringify({ from: "other" }), "EX", 60);
    expect(await cacheGet(`phase1:${RUN}`)).toEqual({ from: "test" });
  });

  it("puts BullMQ queues under this installation's prefix", async () => {
    const ping = await Promise.race([queueConnection.ping().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 1_500))]).catch(() => false);
    if (!ping) return console.log("[phase1 test] Redis unreachable — skipped");
    const queue = createQueue(`phase1-${RUN}`);
    try {
      await queue.add("probe", { n: 1 });
      const keys = await queueConnection.keys(`*phase1-${RUN}*`);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((k) => k.startsWith(`install:test:bull:phase1-${RUN}:`))).toBe(true);
    } finally {
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    }
  });
});
