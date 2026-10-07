import { describe, it, expect, afterAll } from "vitest";
import { ORDER_QUEUE_FILTERS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, placeOrder } from "../../test-fixtures";
import { getOrderStats, listOrders } from "./order.service";

// Blueprint V2 §K2: the "Needs action" queue and the stats' needsAttention count are one predicate.

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

const needsAction = { ...ORDER_QUEUE_FILTERS.needsAction, page: 1, pageSize: 100 } as never;

async function freshOrder() {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
  return placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
}

async function idsInQueue(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 1; ; page++) {
    const result = await listOrders({ ...ORDER_QUEUE_FILTERS.needsAction, page, pageSize: 100 } as never);
    for (const o of result.items) ids.add(o.id);
    if (page * 100 >= result.total) break;
  }
  return ids;
}

describe("Needs action queue", () => {
  it("lists exactly what the stats count", async () => {
    await freshOrder();
    const [list, stats] = await Promise.all([listOrders(needsAction), getOrderStats()]);
    expect(list.total).toBe(stats.needsAttention);
    expect(stats.queueCounts.needsAction).toBe(stats.needsAttention);
  });

  it("holds a day-old pending order, a due callback and an unreconciled partial delivery — not a fresh pending order", async () => {
    const fresh = await freshOrder();
    const stale = await freshOrder();
    await prisma.order.update({ where: { id: stale.id }, data: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });
    const callback = await freshOrder();
    await prisma.order.update({ where: { id: callback.id }, data: { followUpAt: new Date(Date.now() - 60_000) } });
    const partial = await freshOrder();
    await prisma.order.update({ where: { id: partial.id }, data: { status: "PARTIALLY_DELIVERED", partialDeliveryReconciledAt: null } });

    const ids = await idsInQueue();
    expect(ids.has(stale.id)).toBe(true);
    expect(ids.has(callback.id)).toBe(true);
    expect(ids.has(partial.id)).toBe(true);
    expect(ids.has(fresh.id)).toBe(false);
  });
});
