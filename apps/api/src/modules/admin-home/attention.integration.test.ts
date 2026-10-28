import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { getOrderStats } from "../orders/order.service";
import { adminAttention } from "./attention.service";

// Blueprint V2 PERF-03: one composite attention read for the shell, scoped to the caller's permissions.

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("admin attention composite", () => {
  it("returns every section for an owner, with the same order numbers as /api/orders/stats", async () => {
    const agent = await asOwner();
    const res = await agent.get("/api/v1/admin/attention");
    expect(res.status).toBe(200);
    expect(res.body.payments).not.toBeNull();
    expect(typeof res.body.pendingReviews).toBe("number");
    expect(typeof res.body.unreadFeedback).toBe("number");
    expect(typeof res.body.unreadNotifications).toBe("number");
    const stats = await getOrderStats();
    expect(res.body.orders).toMatchObject({ pending: stats.pending, needsAttention: stats.needsAttention, returnRequestsPending: stats.returnRequestsPending });
  });

  it("leaves out sections the admin may not read", async () => {
    const result = await adminAttention({ adminId: await ownerId(), role: "STAFF", permissions: ["orders.read"] });
    expect(result.orders).not.toBeNull();
    expect(result.payments).toBeNull();
    expect(result.pendingReviews).toBeNull();
    expect(result.unreadFeedback).toBeNull();
  });

  it("refuses an anonymous caller", async () => {
    expect((await request(app).get("/api/v1/admin/attention")).status).toBe(401);
  });
});

describe("store capabilities (owner decision Q-G)", () => {
  it("says whether the store has production, from its own data", async () => {
    const agent = await asOwner();
    const res = await agent.get("/api/v1/admin/store-capabilities");
    expect(res.status).toBe(200);
    const has = Boolean(
      (await prisma.product.count({ where: { kind: "MATERIAL", deletedAt: null } })) ||
        (await prisma.product.count({ where: { fillToOrder: true, deletedAt: null } })) ||
        (await prisma.billOfMaterials.count()) ||
        (await prisma.productionOrder.count()),
    );
    expect(res.body).toEqual({ production: has });
  });

  it("refuses an anonymous caller", async () => {
    expect((await request(app).get("/api/v1/admin/store-capabilities")).status).toBe(401);
  });
});

describe("Home queue additions (blueprint P1.2)", () => {
  it("owner decision Q6: a COD order still pending after 48 h is listed and counted; a fresh one is not", async () => {
    const { variants } = await createStockedProduct({ stocks: [5] });
    const old = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    const fresh = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    expect(old.paymentMethod).toBe("COD");
    await prisma.order.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 49 * 3_600_000) } });
    const agent = await asOwner();
    const list = await agent.get("/api/orders?codPendingStale=true&limit=100");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const ids = (list.body.items ?? list.body.orders ?? list.body.data).map((o: { id: string }) => o.id);
    expect(ids).toContain(old.id);
    expect(ids).not.toContain(fresh.id);
    const stats = await getOrderStats();
    expect(stats.queueCounts.codPendingStale).toBeGreaterThanOrEqual(1);
    // the order itself is untouched: nothing is released or cancelled automatically
    expect((await prisma.order.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("PENDING");
  });

  it("carries the duplicate-purchase and stock-waiting counts for roles that read them, null otherwise", async () => {
    const owner = await adminAttention({ adminId: await ownerId(), role: "OWNER", permissions: ["purchasing.read", "inventory.read"] });
    expect(typeof owner.possibleDuplicatePurchases).toBe("number");
    expect(owner.stock).toMatchObject({ countLossesToApprove: expect.any(Number), fillFailures: expect.any(Number) });
    const staff = await adminAttention({ adminId: await ownerId(), role: "STAFF", permissions: ["orders.read"] });
    expect(staff.possibleDuplicatePurchases).toBeNull();
    expect(staff.stock).toBeNull();
  });
});
