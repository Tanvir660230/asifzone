import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { registerErrorReporter } from "../../lib/observability/error-capture";
import { createErrorStoreReporter } from "../../lib/observability/error-store-reporter";

const RUN = `cer${Date.now().toString(36)}`;
const store = createErrorStoreReporter({ flushIntervalMs: 60_000 });
let unregister: () => void;

beforeAll(() => {
  unregister = registerErrorReporter(store.report);
});
afterAll(async () => {
  unregister();
  store.stop();
  await prisma.errorGroup.deleteMany({ where: { title: { contains: RUN } } });
});

const valid = {
  message: `${RUN} Cannot read properties of undefined (reading 'price')`,
  stack: `TypeError: x\n    at ProductCard (https://asifzone.com/_next/static/chunks/app/page-abc.js:1:2000)`,
  digest: "1234567890",
  path: "/products/black-panjabi",
  kind: "unhandled",
};

describe("POST /api/v1/client-errors", () => {
  it("accepts a crash report from the website and files it under the website", async () => {
    await request(app).post("/api/v1/client-errors").send(valid).expect(204);
    await store.flush();
    const row = await prisma.errorGroup.findFirstOrThrow({ where: { title: { contains: RUN } } });
    expect(row).toMatchObject({ source: "web", lastPath: "/products/black-panjabi", count: 1 });
    expect(row.title.startsWith("ClientError: ")).toBe(true);
    expect(row.sampleStack).toContain("_next/static/chunks");
  });

  it("keeps the top frame of a Safari / Firefox stack", async () => {
    const safari = { ...valid, message: `${RUN} safari crash`, stack: "renderCard@https://asifzone.com/_next/static/chunks/app/page-abc.js:1:20\nouter@https://asifzone.com/_next/static/chunks/main.js:1:5" };
    await request(app).post("/api/v1/client-errors").send(safari).expect(204);
    await store.flush();
    const row = await prisma.errorGroup.findFirstOrThrow({ where: { title: { contains: `${RUN} safari crash` } } });
    expect(row.sampleStack).toContain("renderCard@");
  });

  it("works without a CSRF token (it is sent with sendBeacon)", async () => {
    await request(app).post("/api/v1/client-errors").set("Cookie", "customer_access_token=stale").send(valid).expect(204);
  });

  it("refuses oversized or malformed reports", async () => {
    await request(app).post("/api/v1/client-errors").send({ ...valid, message: "x".repeat(501) }).expect(400);
    await request(app).post("/api/v1/client-errors").send({ ...valid, stack: "x".repeat(4001) }).expect(400);
    await request(app).post("/api/v1/client-errors").send({ ...valid, path: "https://evil.example/" }).expect(400);
    await request(app).post("/api/v1/client-errors").send({ ...valid, kind: "other" }).expect(400);
    await request(app).post("/api/v1/client-errors").send({ path: "/" }).expect(400);
  });

  // Last: it uses up this IP's budget.
  it("rate-limits one visitor", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 65; i++) statuses.push((await request(app).post("/api/v1/client-errors").send(valid)).status);
    expect(statuses).toContain(429);
  });
});
