import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "../../config/prisma";
import type { CapturedError } from "./error-capture";
import * as capture from "./error-capture";
import { createErrorStoreReporter } from "./error-store-reporter";
import { fingerprintError } from "./error-fingerprint";

const RUN = `esr${Date.now().toString(36)}`;

function occurrence(tag: string, context?: Record<string, unknown>): CapturedError {
  const error = new Error(`${RUN} ${tag} failed`);
  error.stack = `Error: ${error.message}\n    at work (/app/apps/api/src/${RUN}/${tag}.ts:1:1)`;
  return { error, errorClass: "unexpected", correlationId: "corr-12345678", operation: "POST /api/orders/", context };
}

const reporters: Array<{ stop(): void }> = [];
function reporter(opts?: Parameters<typeof createErrorStoreReporter>[0]) {
  const r = createErrorStoreReporter({ flushIntervalMs: 60_000, ...opts });
  reporters.push(r);
  return r;
}

afterEach(async () => {
  reporters.splice(0).forEach((r) => r.stop());
  vi.restoreAllMocks();
  await prisma.errorGroup.deleteMany({ where: { title: { contains: RUN } } });
});

describe("error store reporter", () => {
  it("stores a thousand repeats of one failure as one group with its count", async () => {
    const r = reporter();
    for (let i = 0; i < 1000; i++) r.report(occurrence("storm", { route: "POST /api/orders/" }));
    await r.flush();

    const rows = await prisma.errorGroup.findMany({ where: { title: { contains: RUN } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 1000, source: "api", errorClass: "unexpected", lastPath: "POST /api/orders/", lastCorrelationId: "corr-12345678", resolvedAt: null });
    expect(rows[0]!.title).toBe(`Error: ${RUN} storm failed`);
  });

  it("adds later flushes to the same group", async () => {
    const r = reporter();
    r.report(occurrence("twice"));
    await r.flush();
    r.report(occurrence("twice"));
    r.report(occurrence("twice"));
    await r.flush();
    const row = await prisma.errorGroup.findUniqueOrThrow({ where: { fingerprint: fingerprintError(occurrence("twice")) } });
    expect(row.count).toBe(3);
  });

  it("reopens a group marked fixed when it happens again", async () => {
    const r = reporter();
    r.report(occurrence("reopen"));
    await r.flush();
    const fingerprint = fingerprintError(occurrence("reopen"));
    await prisma.errorGroup.update({ where: { fingerprint }, data: { resolvedAt: new Date() } });

    r.report(occurrence("reopen"));
    await r.flush();
    const row = await prisma.errorGroup.findUniqueOrThrow({ where: { fingerprint } });
    expect(row.resolvedAt).toBeNull();
    expect(row.count).toBe(2);
  });

  it("keeps at most maxGroups distinct failures per flush", async () => {
    const r = reporter({ maxGroups: 20 });
    for (let i = 0; i < 30; i++) r.report(occurrence(`distinct${i}`));
    await r.flush();
    expect(await prisma.errorGroup.count({ where: { title: { contains: RUN } } })).toBe(20);
  });

  it("records website errors with their path, masked", async () => {
    const r = reporter();
    r.report(occurrence("web", { source: "web", path: "/checkout?phone=01712345678" }));
    await r.flush();
    const row = await prisma.errorGroup.findFirstOrThrow({ where: { title: { contains: RUN } } });
    expect(row.source).toBe("web");
    expect(row.lastPath).not.toContain("12345678");
  });

  it("drops the batch quietly when the database is down, without reporting about itself", async () => {
    const r = reporter();
    const spy = vi.spyOn(capture, "captureError");
    vi.spyOn(prisma.errorGroup, "upsert").mockRejectedValue(new Error("connection refused"));
    r.report(occurrence("dbdown"));
    await expect(r.flush()).resolves.toBeUndefined();
    vi.mocked(prisma.errorGroup.upsert).mockRestore();
    await r.flush(); // buffer was emptied: nothing left to write
    expect(await prisma.errorGroup.count({ where: { title: { contains: RUN } } })).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns from report without waiting for the database", () => {
    const r = reporter();
    const upsert = vi.spyOn(prisma.errorGroup, "upsert");
    expect(r.report(occurrence("sync"))).toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
  });
});
