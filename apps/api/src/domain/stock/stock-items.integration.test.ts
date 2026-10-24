import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, RUN } from "../../test-fixtures";
import { listStockItems } from "./stock-items.service";

// Smart stock page, task 2: the stock list — search, status counts, paging that never repeats or skips, and costs hidden
// without costing.read. Every query is narrowed to this run's SKUs, so other rows in the test database don't matter.

const CSRF = "vitest-csrf";
const N = 1500;
let admin = "";
let prefix = "";
let few = "";

beforeAll(async () => {
  admin = await ownerId();
  const big = await createStockedProduct({ stocks: Array.from({ length: N }, (_, i) => (i % 3 === 0 ? 0 : 4)), published: false });
  prefix = big.variants[0]!.sku.replace(/-\d+$/, "-");
  few = (await createStockedProduct({ stocks: [2, 0] })).variants[0]!.sku.replace(/-\d+$/, "-");
}, 600_000);

afterAll(async () => {
  await cleanupFixtures();
});

describe("listStockItems", () => {
  it("L-1: search matches the sku, case-insensitively", async () => {
    const r = await listStockItems({ q: few.toLowerCase(), limit: 50 }, { canSeeCost: true });
    expect(r.items.map((i) => i.sku).sort()).toEqual([`${few}0`, `${few}1`]);
  });

  it("L-2: counts honour the search but not the status filter", async () => {
    // the size with none in stock and no recent use or orders is EMPTY, not OUT
    const r = await listStockItems({ q: few, status: "EMPTY", limit: 50 }, { canSeeCost: true });
    expect(r.items.map((i) => i.sku)).toEqual([`${few}1`]);
    expect(r.counts.ALL).toBe(2);
    expect(r.counts.EMPTY).toBe(1);
    expect(r.counts.OUT).toBe(0);
    expect(r.counts.OUT + r.counts.LOW + r.counts.OK + r.counts.NEEDS_FILL + r.counts.EMPTY).toBe(2);
  });

  it(`L-3: paging ${N} items by 50 returns each exactly once, each page quickly`, async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let slowest = 0;
    do {
      const t = Date.now();
      const page: Awaited<ReturnType<typeof listStockItems>> = await listStockItems({ q: prefix, limit: 50, ...(cursor ? { cursor } : {}) }, { canSeeCost: true });
      slowest = Math.max(slowest, Date.now() - t);
      seen.push(...page.items.map((i) => i.sku));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.length).toBe(N);
    expect(new Set(seen).size).toBe(N);
    expect(slowest).toBeLessThan(800);
  }, 300_000);

  it("L-4: an empty, unused size sorts after a stocked one", async () => {
    const r = await listStockItems({ q: few, limit: 50 }, { canSeeCost: true });
    expect(r.items.map((i) => i.status)).toEqual(["OK", "EMPTY"]);
  });

  it("L-5: values are null without costing.read", async () => {
    const r = await listStockItems({ q: few, limit: 50 }, { canSeeCost: false });
    expect(r.items.every((i) => i.value === null && i.avgCost === null)).toBe(true);
  });
});

describe("GET /api/v1/finance/stock/items", () => {
  const as = (r: request.Test, role = "OWNER") => r.set("Cookie", [`access_token=${signAccessToken({ adminId: admin, role: role as never })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);

  it("H-1: answers with items, counts and a cursor", async () => {
    const res = await as(request(app).get(`/api/v1/finance/stock/items?q=${encodeURIComponent(few)}&limit=1`));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.counts.ALL).toBe(2);
    expect(typeof res.body.nextCursor).toBe("string");
  });

  it("H-2: a bad status is refused", async () => {
    const res = await as(request(app).get("/api/v1/finance/stock/items?status=NOPE"));
    expect(res.status).toBe(400);
  });
});
