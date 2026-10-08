import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { RUN, cleanupFixtures, createStockedProduct, placeOrder } from "../../test-fixtures";

const email = `vitest_summary_${RUN}@example.com`;
let cookies: string[] = [];
let customerId = "";

/** GET /api/customers/me/summary — the one request behind the account home (docs/ACCOUNT_HOME.md). */
describe("account summary", () => {
  beforeAll(async () => {
    const res = await request(app).post("/api/customers/register").send({ name: "Summary Tester", email, password: "SummaryPass1" });
    expect(res.status).toBe(201);
    cookies = res.get("Set-Cookie")!;
    customerId = res.body.customer.id;
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma.customer.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("requires a customer session", async () => {
    const res = await request(app).get("/api/customers/me/summary");
    expect(res.status).toBe(401);
  });

  it("returns an empty summary for a new customer", async () => {
    const res = await request(app).get("/api/customers/me/summary").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      orderCount: 0,
      activeOrder: null,
      recentOrders: [],
      storeBalance: 0,
      rewardPoints: 0,
      wishlistCount: 0,
      pendingReturns: 0,
      defaultAddress: null,
    });
    expect(typeof res.body.summary.currency).toBe("string");
    expect(typeof res.body.summary.couponCount).toBe("number");
  });

  it("picks the newest open order as active and lists the rest as recent", async () => {
    const { variants } = await createStockedProduct({ stocks: [20], basePrice: 700 });
    const variantId = variants[0]!.id;
    const delivered = await placeOrder([{ variantId, quantity: 1 }]);
    await prisma.order.update({ where: { id: delivered.id }, data: { status: "DELIVERED", customerId } });
    const open = await placeOrder([{ variantId, quantity: 2 }]);
    await prisma.order.update({ where: { id: open.id }, data: { status: "PACKED", customerId } });

    const res = await request(app).get("/api/customers/me/summary").set("Cookie", cookies);
    expect(res.status).toBe(200);
    const { summary } = res.body;
    expect(summary.orderCount).toBe(2);
    expect(summary.activeOrder).toMatchObject({ id: open.id, status: "PACKED", itemCount: 2 });
    expect(summary.activeOrder.firstItemName).toContain("Vitest P1");
    expect(summary.activeOrder).toHaveProperty("imageUrl");
    expect(summary.recentOrders.map((o: { id: string }) => o.id)).toEqual([delivered.id]);
    // Customer-facing view only: no staff fields leak through.
    expect(summary.activeOrder).not.toHaveProperty("adminNotes");
  });

  it("lists own orders with a preview image and without trashed orders", async () => {
    const { variants } = await createStockedProduct({ stocks: [5] });
    const trashed = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    await prisma.order.update({ where: { id: trashed.id }, data: { customerId, deletedAt: new Date() } });

    const res = await request(app).get("/api/customers/me/orders").set("Cookie", cookies);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((o: { id: string }) => o.id);
    expect(ids).not.toContain(trashed.id);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0]).toHaveProperty("previewImageUrl");
  });

  it("does not show another customer's orders", async () => {
    const other = await request(app).post("/api/customers/register").send({ name: "Other", email: `vitest_summary_other_${RUN}@example.com`, password: "SummaryPass1" });
    const res = await request(app).get("/api/customers/me/summary").set("Cookie", other.get("Set-Cookie")!);
    expect(res.body.summary.orderCount).toBe(0);
    await prisma.customer.deleteMany({ where: { email: `vitest_summary_other_${RUN}@example.com` } });
  });
});
