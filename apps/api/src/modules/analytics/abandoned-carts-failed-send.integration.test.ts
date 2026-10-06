import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../../config/prisma";
import { RUN, asOwner, cleanupFixtures, createStockedProduct } from "../../test-fixtures";
import { ABANDONMENT_THRESHOLD_MS } from "../cart/cart.service";
import { utcInstant } from "../../domain/metrics/store-time";

// A reminder the SMS provider rejects must leave the cart looking un-reminded, so the admin can retry it. Kept in its own
// file because the provider is mocked module-wide here (abandoned-carts.integration.test.ts covers the successful send).
vi.mock("../../providers/sms/bulksmsbd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/sms/bulksmsbd")>()),
  sendSms: vi.fn().mockRejectedValue(new Error("provider down")),
}));

let customerId: string;

beforeAll(async () => {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 400 });
  const customer = await prisma.customer.create({
    data: { name: `Cart Fail ${RUN}`, phone: `018${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, smsMarketingOptIn: true },
  });
  customerId = customer.id;
  const cart = await prisma.cart.create({ data: { customerId, items: { create: [{ variantId: variants[0]!.id, quantity: 1 }] } } });
  const stale = new Date(Date.now() - ABANDONMENT_THRESHOLD_MS - 60 * 60 * 1000);
  await prisma.$executeRaw`UPDATE "Cart" SET "updatedAt" = ${utcInstant(stale)} WHERE id = ${cart.id}`;
});

afterAll(async () => {
  if (customerId) {
    const recipients = await prisma.campaignRecipient.findMany({ where: { customerId }, select: { campaignId: true } });
    const campaignIds = [...new Set(recipients.map((r) => r.campaignId))];
    if (campaignIds.length) await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
  }
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("abandoned-cart reminder when the provider fails", () => {
  it("reports the failure and does not stamp reminderSentAt", async () => {
    const api = await asOwner();
    const res = await api.post("/api/analytics/abandoned-carts/remind", { customerIds: [customerId], body: "Hi {{first_name}}" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 0, failed: 1 });
    const cart = await prisma.cart.findUniqueOrThrow({ where: { customerId } });
    expect(cart.reminderSentAt).toBeNull();
  });
});
