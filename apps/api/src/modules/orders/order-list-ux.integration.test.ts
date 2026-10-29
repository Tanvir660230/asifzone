import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { Prisma } from "@prisma/client";
import { ORDER_QUEUE_FILTERS, orderListQuerySchema } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { getOrderStats, listOrders } from "./order.service";

// Order Operations plan, phase 2: the Orders list's page sizes, exact parcel-code search, the "Ready to book" queue and
// per-admin display preferences.

/** The owner starts and ends with no stored preferences (an e2e run may have saved some). */
const clearOwnerPrefs = async () => prisma.adminUser.updateMany({ where: { id: await ownerId() }, data: { listPreferences: Prisma.DbNull } });
beforeAll(clearOwnerPrefs);

afterAll(async () => {
  await clearOwnerPrefs();
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function freshOrder() {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
  return placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
}

async function allIds(query: Record<string, unknown>): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 1; ; page++) {
    const result = await listOrders({ ...query, page, pageSize: 200 } as never);
    for (const o of result.items) ids.add(o.id);
    if (page * 200 >= result.total) break;
  }
  return ids;
}

describe("Orders list page sizes", () => {
  it("accepts up to 200 rows a page and refuses more", () => {
    expect(orderListQuerySchema.parse({ pageSize: "200" }).pageSize).toBe(200);
    expect(orderListQuerySchema.safeParse({ pageSize: "201" }).success).toBe(false);
  });

  it("serves a 200-row page over HTTP", async () => {
    const agent = await asOwner();
    const res = await agent.get("/api/orders?page=1&pageSize=200");
    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(200);
    expect((await agent.get("/api/orders?pageSize=500")).status).toBe(400);
  });
});

describe("Orders search on parcel codes", () => {
  it("finds an order by its exact label barcode or consignment id, trimmed", async () => {
    const order = await freshOrder();
    const code = `AZT${Date.now().toString(36).toUpperCase()}`;
    const cid = `${Date.now()}`;
    await prisma.order.update({ where: { id: order.id }, data: { trackingNumber: code, courierConsignmentId: cid } });

    expect([...(await allIds({ search: code }))]).toEqual([order.id]);
    expect([...(await allIds({ search: cid }))]).toEqual([order.id]);
    expect([...(await allIds(orderListQuerySchema.parse({ search: `  ${code}  ` }) as never))]).toEqual([order.id]);
    // Exact, not partial: half a barcode is not a match.
    expect((await allIds({ search: code.slice(0, -2) })).has(order.id)).toBe(false);
  });
});

describe("Latest activity order", () => {
  it("brings an order placed days ago back to the top once it is confirmed — an edit that keeps the status does not", async () => {
    const old = await freshOrder();
    const fresh = await freshOrder();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await prisma.order.update({ where: { id: old.id }, data: { createdAt: threeDaysAgo, statusChangedAt: threeDaysAgo } });

    const byActivity = { sortBy: "statusChangedAt", sortDir: "desc", page: 1, pageSize: 200 } as never;
    const position = async (id: string) => (await listOrders(byActivity)).items.findIndex((o) => o.id === id);
    expect(await position(old.id)).toBeGreaterThan(await position(fresh.id));

    // Any status change stamps the time (database trigger), whichever code path made it.
    await prisma.order.update({ where: { id: old.id }, data: { status: "CONFIRMED" } });
    const confirmed = await prisma.order.findUniqueOrThrow({ where: { id: old.id } });
    expect(confirmed.statusChangedAt.getTime()).toBeGreaterThan(threeDaysAgo.getTime() + 60_000);
    expect(await position(old.id)).toBe(0);

    // A courier poll or an edit that leaves the status alone doesn't move it.
    const stampOf = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).statusChangedAt.getTime();
    const before = await stampOf(fresh.id);
    await new Promise((r) => setTimeout(r, 20));
    await prisma.order.update({ where: { id: fresh.id }, data: { courierStatus: "in_review", status: "PENDING" } });
    expect(await stampOf(fresh.id)).toBe(before);
  });

  it("pages without repeats or gaps when many rows share a sort value", async () => {
    const seen = new Set<string>();
    let total = 0;
    for (let page = 1; ; page++) {
      const r = await listOrders({ sortBy: "status", sortDir: "asc", page, pageSize: 25 } as never);
      total = r.total;
      for (const o of r.items) {
        expect(seen.has(o.id)).toBe(false);
        seen.add(o.id);
      }
      if (page * 25 >= r.total) break;
    }
    expect(seen.size).toBe(total);
  });
});

describe("Ready to book queue", () => {
  it("holds confirmed, unbooked, live orders — and its badge equals the list", async () => {
    const pending = await freshOrder();
    const confirmed = await freshOrder();
    const booked = await freshOrder();
    const trashed = await freshOrder();
    await prisma.order.updateMany({ where: { id: { in: [confirmed.id, booked.id, trashed.id] } }, data: { status: "CONFIRMED" } });
    await prisma.order.update({ where: { id: booked.id }, data: { courierConsignmentId: `rb-${Date.now()}` } });
    await prisma.order.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });

    const ids = await allIds(ORDER_QUEUE_FILTERS.readyToBook);
    expect(ids.has(confirmed.id)).toBe(true);
    expect(ids.has(pending.id)).toBe(false);
    expect(ids.has(booked.id)).toBe(false);
    expect(ids.has(trashed.id)).toBe(false);

    const stats = await getOrderStats();
    expect(stats.queueCounts.readyToBook).toBe(ids.size);
  });
});

describe("List display preferences", () => {
  it("keeps each admin's density, page size and columns per list, merging changes", async () => {
    const agent = await asOwner();
    expect((await agent.get("/api/v1/admin/list-preferences/orders")).body).toEqual({});

    const saved = await agent.put("/api/v1/admin/list-preferences/orders", { density: "compact", pageSize: 100 });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ density: "compact", pageSize: 100 });

    await agent.put("/api/v1/admin/list-preferences/orders", { hiddenColumns: ["product"] });
    await agent.put("/api/v1/admin/list-preferences/customers", { density: "comfortable" });
    expect((await agent.get("/api/v1/admin/list-preferences/orders")).body).toEqual({ density: "compact", pageSize: 100, hiddenColumns: ["product"] });
    expect((await agent.get("/api/v1/admin/list-preferences/customers")).body).toEqual({ density: "comfortable" });
  });

  it("refuses a page size or density the list doesn't offer", async () => {
    const agent = await asOwner();
    expect((await agent.put("/api/v1/admin/list-preferences/orders", { pageSize: 30 })).status).toBe(400);
    expect((await agent.put("/api/v1/admin/list-preferences/orders", { density: "tiny" })).status).toBe(400);
    expect((await agent.get("/api/v1/admin/list-preferences/Bad!")).status).toBe(400);
  });
});

describe("Parcel queue order", () => {
  it("Handover pending lists the oldest booking first until a column is picked", async () => {
    const book = async (hoursAgo: number) => {
      const o = await freshOrder();
      await prisma.order.update({
        where: { id: o.id },
        data: { status: "CONFIRMED", courierConsignmentId: `8${Date.now()}${Math.random().toString().slice(2, 6)}`, courierBookedAt: new Date(Date.now() - hoursAgo * 3_600_000) },
      });
      return o.id;
    };
    const newer = await book(2);
    const older = await book(30);
    const ids = (await listOrders({ ...ORDER_QUEUE_FILTERS.handoverPending, page: 1, pageSize: 200 } as never)).items.map((o) => o.id);
    expect(ids.indexOf(older)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(newer));
    // A picked column wins: by date placed (oldest first), the order placed first — the newer booking — leads.
    const byPlaced = (await listOrders({ ...ORDER_QUEUE_FILTERS.handoverPending, sortBy: "createdAt", sortDir: "asc", page: 1, pageSize: 200 } as never)).items.map((o) => o.id);
    expect(byPlaced.indexOf(newer)).toBeLessThan(byPlaced.indexOf(older));
  });
});
