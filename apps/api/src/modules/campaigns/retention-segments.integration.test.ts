import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";
import { campaignAudience, resolveSegmentCustomers } from "./campaign.service";

// Retention audiences (2026-11-20): win back customers who bought before and went quiet, thank repeat buyers, and nudge a
// first-time buyer toward a second order. Only delivered orders count as "bought"; marketing consent rules stay.

const RUN = Date.now().toString(36).slice(-6);
const DAY = 86_400_000;
const customers: Record<string, string> = {};
let admin: string;
let variantId: string;

async function customer(key: string, smsOptIn = false) {
  const c = await prisma.customer.create({ data: { name: `Retention ${key} ${RUN}`, phone: `01719${String((Date.now() % 900000) + Object.keys(customers).length).padStart(6, "0")}`, smsMarketingOptIn: smsOptIn } });
  customers[key] = c.id;
  return c.id;
}

async function deliveredOrder(customerId: string, daysAgo: number, status: "DELIVERED" | "CANCELLED" = "DELIVERED") {
  const order = await placeOrder([{ variantId, quantity: 1 }]);
  await updateOrderStatus(order.id, { status: status === "DELIVERED" ? "DELIVERED" : "CANCELLED", ...(status === "CANCELLED" ? { note: "test", cancelReason: "OTHER" } : {}) } as never, admin);
  await prisma.order.update({ where: { id: order.id }, data: { customerId, createdAt: new Date(Date.now() - daysAgo * DAY) } });
  return order.id;
}

beforeAll(async () => {
  admin = await ownerId();
  variantId = (await createStockedProduct({ stocks: [50], basePrice: 500 })).variants[0]!.id;
  const quiet = await customer("quiet", true);
  await deliveredOrder(quiet, 90);
  const repeat = await customer("repeat");
  await deliveredOrder(repeat, 100);
  await deliveredOrder(repeat, 20);
  const first = await customer("first");
  await deliveredOrder(first, 30);
  const fresh = await customer("fresh");
  await deliveredOrder(fresh, 5);
  await customer("never");
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.customer.deleteMany({ where: { id: { in: Object.values(customers) } } });
  await prisma.$disconnect();
});

const idsOf = async (type: Parameters<typeof resolveSegmentCustomers>[0]) => new Set((await resolveSegmentCustomers(type)).map((c) => c.id));

describe("retention audiences", () => {
  it("win back: bought before, nothing ordered in the last 60 days", async () => {
    const ids = await idsOf("WIN_BACK");
    expect(ids.has(customers.quiet!)).toBe(true);
    for (const k of ["repeat", "first", "fresh", "never"]) expect(ids.has(customers[k]!), k).toBe(false);
  });

  it("repeat buyers: two or more delivered orders", async () => {
    const ids = await idsOf("REPEAT_BUYERS");
    expect(ids.has(customers.repeat!)).toBe(true);
    for (const k of ["quiet", "first", "fresh", "never"]) expect(ids.has(customers[k]!), k).toBe(false);
  });

  it("second-order nudge: exactly one delivered order, 14 to 60 days ago, nothing since", async () => {
    const ids = await idsOf("SECOND_ORDER_NUDGE");
    expect(ids.has(customers.first!)).toBe(true);
    for (const k of ["quiet", "repeat", "fresh", "never"]) expect(ids.has(customers[k]!), k).toBe(false);
  });

  it("the audience preview counts who is in it and who the channel can reach (consent kept)", async () => {
    const sms = await campaignAudience("WIN_BACK", "SMS");
    expect(sms.customers).toBeGreaterThanOrEqual(1);
    expect(sms.reachable).toBeLessThanOrEqual(sms.customers);
    expect(sms.reachableIds).toContain(customers.quiet);

    const owner = await asOwner();
    const res = await owner.get("/api/campaigns/audience?segmentType=REPEAT_BUYERS&channel=SMS");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ customers: expect.any(Number), reachable: expect.any(Number) });
    expect(res.body.reachableIds).toBeUndefined();
  });
});
