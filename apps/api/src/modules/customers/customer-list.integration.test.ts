import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { CustomerListQuery, CustomerTag } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { customerMetricsFor, customerMetricsIndex } from "../../domain/metrics/metrics.service";
import { cleanupFixtures, createStockedProduct, placeOrder } from "../../test-fixtures";
import { getCustomerStatsAdmin, listCustomersAdmin, loadCustomersWithComputedFields } from "./customer.service";
import { syncCustomerFacts } from "./customer-facts.service";

// Blueprint V2 PERF-01/02: the customer list filters, sorts and pages in SQL over the CustomerFact read model. These
// tests hold it to the in-memory implementation it replaced (same figures, same tags, same order) and to freshness.

const RUN = Date.now().toString(36);
const createdCustomerIds: string[] = [];

type Row = Awaited<ReturnType<typeof loadCustomersWithComputedFields>>[number];

/** The list as the in-memory implementation computed it — the oracle. Ties: newest first, then id. */
async function reference(query: Partial<CustomerListQuery> & { page: number; pageSize: number }) {
  const where = query.search
    ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { email: { contains: query.search, mode: "insensitive" as const } },
          { phone: { contains: query.search } },
          { orders: { some: { orderNumber: { contains: query.search, mode: "insensitive" as const } } } },
        ],
      }
    : {};
  let rows = await loadCustomersWithComputedFields(where, { fresh: true });
  if (query.tag) rows = rows.filter((c) => c.tags.includes(query.tag!));
  if (query.district) rows = rows.filter((c) => c.district === query.district);
  if (query.noOrders === "true") rows = rows.filter((c) => c.totalOrders === 0);
  if (query.lastOrderDays) {
    const cutoff = Date.now() - query.lastOrderDays * 86_400_000;
    rows = rows.filter((c) => (c.lastOrderAt?.getTime() ?? 0) >= cutoff);
  }
  if (query.minSpend !== undefined) rows = rows.filter((c) => c.totalSpent >= query.minSpend!);
  if (query.minOrders !== undefined) rows = rows.filter((c) => c.totalOrders >= query.minOrders!);
  const dir = query.sortDir === "asc" ? 1 : -1;
  const primary = (a: Row, b: Row): number => {
    switch (query.sortBy ?? "createdAt") {
      case "name": {
        const x = a.name.toLowerCase();
        const y = b.name.toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      }
      case "totalSpent":
        return a.totalSpent - b.totalSpent;
      case "totalOrders":
        return a.totalOrders - b.totalOrders;
      case "lastOrderAt":
        return (a.lastOrderAt?.getTime() ?? 0) - (b.lastOrderAt?.getTime() ?? 0);
      default:
        return a.createdAt.getTime() - b.createdAt.getTime();
    }
  };
  rows.sort((a, b) => dir * primary(a, b) || b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const start = (query.page - 1) * query.pageSize;
  return { total: rows.length, items: rows.slice(start, start + query.pageSize) };
}

const shape = (c: { id: string; totalOrders: number; totalSpent: number; lastOrderAt: Date | null; district: string | null; tags: CustomerTag[] | string[] }) => ({
  id: c.id,
  totalOrders: c.totalOrders,
  totalSpent: Math.round(c.totalSpent * 100) / 100,
  lastOrderAt: c.lastOrderAt ? new Date(c.lastOrderAt).toISOString() : null,
  district: c.district,
  tags: [...c.tags].sort(),
});

async function list(query: Partial<CustomerListQuery> & { page: number; pageSize: number }) {
  return listCustomersAdmin(query as CustomerListQuery);
}

let customerId: string;
let variantId: string;

beforeAll(async () => {
  const product = await createStockedProduct({ stocks: [50] });
  variantId = product.variants[0]!.id;
  customerId = (await prisma.customer.create({ data: { name: `Facts Customer ${RUN}`, phone: `0171${String(Date.now()).slice(-7)}` } })).id;
  createdCustomerIds.push(customerId);
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  await prisma.$disconnect();
});

describe("customer list read model", () => {
  it("computes a customer subset's metrics exactly as the registry's grouping does", async () => {
    const index = await customerMetricsIndex({ fresh: true });
    const ids = (await prisma.customer.findMany({ select: { id: true } })).map((c) => c.id);
    const subset = await customerMetricsFor(ids);
    expect(Object.fromEntries(subset)).toEqual(Object.fromEntries(index));
  });

  it("lists, filters, sorts and pages exactly like the in-memory implementation", async () => {
    const all = await reference({ page: 1, pageSize: 10_000 });
    const sample = all.items.find((c) => c.totalOrders > 0) ?? all.items[0]!;
    const queries: Array<Partial<CustomerListQuery> & { page: number; pageSize: number }> = [
      { page: 1, pageSize: 20 },
      { page: 2, pageSize: 20 },
      ...(["name", "createdAt", "totalSpent", "totalOrders", "lastOrderAt"] as const).flatMap((sortBy) => [
        { page: 1, pageSize: 50, sortBy, sortDir: "asc" as const },
        { page: 1, pageSize: 50, sortBy, sortDir: "desc" as const },
      ]),
      ...(["VIP", "HIGH_SPENDER", "REPEAT", "NEW", "INACTIVE", "SUSPICIOUS", "COD_RISK", "BLOCKED"] as const).map((tag) => ({ page: 1, pageSize: 100, tag })),
      { page: 1, pageSize: 100, noOrders: "true" as const },
      { page: 1, pageSize: 100, minOrders: 2 },
      { page: 1, pageSize: 100, minSpend: 1000, sortBy: "totalSpent" as const, sortDir: "desc" as const },
      { page: 1, pageSize: 100, lastOrderDays: 90 },
      { page: 1, pageSize: 100, search: sample.name.slice(0, 4) },
      ...(sample.district ? [{ page: 1, pageSize: 100, district: sample.district }] : []),
    ];
    for (const q of queries) {
      const [got, want] = await Promise.all([list(q), reference(q)]);
      expect({ q, total: got.total }).toEqual({ q, total: want.total });
      expect(got.items.map(shape)).toEqual(want.items.map(shape));
    }
  });

  it("finds a customer by one of their order numbers", async () => {
    const order = await placeOrder([{ variantId, quantity: 1 }]);
    await prisma.order.update({ where: { id: order.id }, data: { customerId } });
    const res = await list({ page: 1, pageSize: 20, search: order.orderNumber.toLowerCase() });
    expect(res.items.map((c) => c.id)).toContain(customerId);
  });

  it("reflects changes on the next read: a new order, blocking, an order moved away", async () => {
    const before = (await list({ page: 1, pageSize: 5, search: `Facts Customer ${RUN}` })).items[0]!;
    const order = await placeOrder([{ variantId, quantity: 1 }]);
    await prisma.order.update({ where: { id: order.id }, data: { customerId } });
    const after = (await list({ page: 1, pageSize: 5, search: `Facts Customer ${RUN}` })).items[0]!;
    expect(after.totalOrders).toBe(before.totalOrders + 1);
    expect(after.lastOrderAt?.getTime()).toBeGreaterThanOrEqual(order.createdAt.getTime());

    await prisma.customer.update({ where: { id: customerId }, data: { isBlocked: true } });
    expect((await list({ page: 1, pageSize: 5, search: `Facts Customer ${RUN}` })).items[0]!.tags).toContain("BLOCKED");

    // Moving the order to nobody leaves no timestamp on this customer — the trigger marks them.
    await prisma.order.update({ where: { id: order.id }, data: { customerId: null } });
    expect((await list({ page: 1, pageSize: 5, search: `Facts Customer ${RUN}` })).items[0]!.totalOrders).toBe(before.totalOrders);
  });

  it("recomputes a date-based tag when it's due", async () => {
    await syncCustomerFacts();
    // Pretend "New" ended a moment ago: the fact still says NEW, but its expiry has passed.
    await prisma.customer.update({ where: { id: customerId }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    await prisma.customerFact.update({ where: { customerId }, data: { tags: { push: "NEW" }, tagsExpireAt: new Date(Date.now() - 1000) } });
    const row = (await list({ page: 1, pageSize: 5, search: `Facts Customer ${RUN}` })).items[0]!;
    expect(row.tags).not.toContain("NEW");
  });

  it("stats agree with the in-memory computation", async () => {
    const stats = await getCustomerStatsAdmin();
    const rows = await loadCustomersWithComputedFields({}, { fresh: true });
    expect(stats.totalCustomers).toBe(rows.length);
    expect(stats.repeatCustomers).toBe(rows.filter((c) => c.totalOrders >= 2).length);
    expect(stats.oneTimeBuyers).toBe(rows.filter((c) => c.totalOrders === 1).length);
    expect(stats.vipCustomers).toBe(rows.filter((c) => c.tags.includes("VIP")).length);
    expect(stats.blockedCount).toBe(rows.filter((c) => c.tags.includes("BLOCKED")).length);
    expect(stats.lifetimeRevenue).toBeCloseTo(rows.reduce((s, c) => s + c.totalSpent, 0), 2);
    const cutoff = Date.now() - 90 * 86_400_000;
    expect(stats.inactive90).toBe(rows.filter((c) => (c.lastOrderAt ?? c.createdAt).getTime() < cutoff).length);
  });
});
