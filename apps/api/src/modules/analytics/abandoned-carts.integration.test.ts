import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { RUN, asOwner, cleanupFixtures, createStockedProduct } from "../../test-fixtures";
import { ABANDONMENT_THRESHOLD_MS } from "../cart/cart.service";
import { utcInstant } from "../../domain/metrics/store-time";

// Abandoned-cart recovery (dashboard → Abandoned carts): the work list behind the summary count, and the reminder SMS,
// which — unlike the CRM's ad-hoc bulk message — only ever reaches customers who opted in to marketing SMS.

const customerIds: string[] = [];
let optedIn: string;
let optedOut: string;
let fresh: string;
const stale = new Date(Date.now() - ABANDONMENT_THRESHOLD_MS - 60 * 60 * 1000);

async function customerWithCart(opts: { optIn: boolean; abandoned: boolean; variantId: string }) {
  const phone = `017${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const customer = await prisma.customer.create({
    data: { name: `Cart Test ${RUN} ${customerIds.length}`, phone, smsMarketingOptIn: opts.optIn },
  });
  customerIds.push(customer.id);
  const cart = await prisma.cart.create({ data: { customerId: customer.id, items: { create: [{ variantId: opts.variantId, quantity: 2 }] } } });
  if (opts.abandoned) await prisma.$executeRaw`UPDATE "Cart" SET "updatedAt" = ${utcInstant(stale)} WHERE id = ${cart.id}`;
  return customer.id;
}

beforeAll(async () => {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: 500 });
  const variantId = variants[0]!.id;
  optedIn = await customerWithCart({ optIn: true, abandoned: true, variantId });
  optedOut = await customerWithCart({ optIn: false, abandoned: true, variantId });
  fresh = await customerWithCart({ optIn: true, abandoned: false, variantId });
});

afterAll(async () => {
  if (customerIds.length) {
    const recipients = await prisma.campaignRecipient.findMany({ where: { customerId: { in: customerIds } }, select: { campaignId: true } });
    const campaignIds = [...new Set(recipients.map((r) => r.campaignId))];
    if (campaignIds.length) await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("abandoned-cart recovery", () => {
  it("lists only carts past the abandonment threshold, with value and reachability", async () => {
    const api = await asOwner();
    const res = await api.get("/api/analytics/abandoned-carts?limit=100");
    expect(res.status).toBe(200);
    const rows = res.body.carts as Array<{ customerId: string; reachable: boolean; itemCount: number; value: number }>;
    const byCustomer = new Map(rows.map((r) => [r.customerId, r]));

    expect(byCustomer.get(optedIn)).toMatchObject({ reachable: true, itemCount: 2, value: 1000 });
    expect(byCustomer.get(optedOut)).toMatchObject({ reachable: false });
    expect(byCustomer.has(fresh)).toBe(false);
  });

  it("reminds only opted-in abandoned carts and stamps them without restarting the abandonment clock", async () => {
    const api = await asOwner();
    const res = await api.post("/api/analytics/abandoned-carts/remind", { customerIds: [optedIn, optedOut, fresh], body: "You left something behind, {{first_name}}" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 1, failed: 0, skipped: 2 });

    const reminded = await prisma.cart.findUniqueOrThrow({ where: { customerId: optedIn } });
    expect(reminded.reminderSentAt).not.toBeNull();
    expect(reminded.updatedAt.getTime()).toBe(stale.getTime());
    const skipped = await prisma.cart.findUniqueOrThrow({ where: { customerId: optedOut } });
    expect(skipped.reminderSentAt).toBeNull();
  });

  it("refuses when nobody selected can be messaged", async () => {
    const api = await asOwner();
    const res = await api.post("/api/analytics/abandoned-carts/remind", { customerIds: [optedOut], body: "Hi" });
    expect(res.status).toBe(400);
  });
});
