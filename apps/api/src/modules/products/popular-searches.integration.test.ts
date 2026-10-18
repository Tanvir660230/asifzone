import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix } from "../../config/redis";
import { RUN } from "../../test-fixtures";

// The storefront's "Popular searches" are suggestions to tap. Live Nasihamart listed "{search_term_string}" — the
// placeholder of the site's own JSON-LD SearchAction, fetched literally by crawlers — and test junk like "zzzzqq" that
// finds nothing. A suggestion must be a real search that found products.

const made: string[] = [];
async function logged(query: string, resultCount: number, times = 1000) {
  const before = new Set((await prisma.searchLog.findMany({ where: { query }, select: { id: true } })).map((r) => r.id));
  await prisma.searchLog.createMany({ data: Array.from({ length: times }, () => ({ query, resultCount })) });
  const rows = await prisma.searchLog.findMany({ where: { query }, select: { id: true } });
  made.push(...rows.map((r) => r.id).filter((id) => !before.has(id)));
}
const popular = async () => {
  await cacheDelByPrefix("products:popular-searches");
  const res = await request(app).get("/api/products/storefront/popular-searches").query({ limit: "20" });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.queries as string[];
};

afterAll(async () => {
  await prisma.searchLog.deleteMany({ where: { id: { in: made } } });
  await cacheDelByPrefix("products:popular-searches");
  await prisma.$disconnect();
});

describe("popular searches", () => {
  it("lists searches that found products, never a template placeholder, a no-result search or a single letter", async () => {
    const good = `vtpop ${RUN} attar`;
    const empty = `vtpop ${RUN} zzzzqq`;
    await logged(good, 4);
    await logged(empty, 0);
    await logged("{search_term_string}", 0);
    await logged("{search_term_string}\\", 2);
    await logged("q", 7);
    const queries = await popular();
    expect(queries).toContain(good);
    expect(queries).not.toContain(empty);
    expect(queries.filter((q) => q.includes("{") || q.length < 2)).toEqual([]);
  });

  it("does not log a crawler's literal SearchAction placeholder as a search", async () => {
    const before = await prisma.searchLog.count({ where: { query: { contains: "search_term_string" } } });
    await request(app).get("/api/products/storefront").query({ search: "{search_term_string}" });
    await new Promise((r) => setTimeout(r, 200)); // logging is fire-and-forget
    expect(await prisma.searchLog.count({ where: { query: { contains: "search_term_string" } } })).toBe(before);
  });
});
