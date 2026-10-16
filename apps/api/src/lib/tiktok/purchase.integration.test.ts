import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const live = vi.hoisted(() => ({ on: false }));
vi.mock("../provider-guard", async (orig) => ({ ...(await orig<typeof import("../provider-guard")>()), liveProvidersEnabled: () => live.on }));

import crypto from "crypto";
import { metaPurchaseEventId } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { createOrder } from "../../modules/orders/order.service";
import { checkout, cleanupFixtures, createStockedProduct } from "../../test-fixtures";
import { buildTikTokPurchaseEvent, processTikTokPurchase } from "./purchase";

const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const PRICE = 1250;
let variantId: string;
const orderIds: string[] = [];

beforeAll(async () => {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: PRICE });
  variantId = variants[0]!.id;
});

afterEach(() => {
  live.on = false;
});

afterAll(async () => {
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await cleanupFixtures();
});

async function storefrontOrder(email: string | undefined, context = {}) {
  const order = await createOrder(checkout([{ variantId, quantity: 2 }], { customerPhone: "01712345678", customerEmail: email }), null, { metaContext: context });
  orderIds.push(order.id);
  return order;
}

describe("TikTok server-side Purchase", () => {
  it("builds the event from the stored order with the browser pixel's event id", async () => {
    const order = await storefrontOrder(" Rahim@Example.COM ");
    const event = await buildTikTokPurchaseEvent(order.id, { clientIpAddress: "203.0.113.9", clientUserAgent: "Mozilla/5.0", ttp: "2AbCdEfGhIjKlMnOp", ttclid: "E.C.P.abc123" });

    expect(event).toMatchObject({
      event: "Purchase",
      event_id: metaPurchaseEventId(order.orderNumber),
      user: {
        email: sha("rahim@example.com"),
        phone: sha("+8801712345678"),
        ip: "203.0.113.9",
        user_agent: "Mozilla/5.0",
        ttp: "2AbCdEfGhIjKlMnOp",
        ttclid: "E.C.P.abc123",
      },
      properties: {
        currency: "BDT",
        value: Number(order.total),
        order_id: order.orderNumber,
        content_type: "product",
        contents: [{ content_id: variantId, quantity: 2, price: PRICE }],
      },
    });
    expect(event!.page.url).toMatch(new RegExp(`/order-confirmation/${order.orderNumber}$`));
    expect(event!.event_time).toBe(Math.floor(order.createdAt.getTime() / 1000));
  });

  it("leaves out what the order doesn't have", async () => {
    const order = await storefrontOrder(undefined);
    const event = await buildTikTokPurchaseEvent(order.id, {});
    expect(event!.user).not.toHaveProperty("email");
    expect(event!.user).not.toHaveProperty("ttclid");
    expect(event!.user).not.toHaveProperty("ip");
    // Checkout links every order to a customer record (by phone), whose id is sent hashed.
    if (order.customerId) expect(event!.user.external_id).toBe(sha(order.customerId));
  });

  it("sends nothing for an order that no longer exists", async () => {
    expect(await buildTikTokPurchaseEvent("missing-order", {})).toBeNull();
    await expect(processTikTokPurchase({ orderId: "missing-order", context: {} })).resolves.toBeUndefined();
  });

  it("queues a TikTok Purchase with a storefront order only when TikTok is set up", async () => {
    const off = await storefrontOrder(undefined);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: off.id, consumer: "tiktok-events-purchase" } })).toBe(0);

    live.on = true;
    const restore = overrideIntegrationsForTests({ TIKTOK_PIXEL_ID: "CPIXEL123", TIKTOK_ACCESS_TOKEN: "t", TIKTOK_TEST_EVENT_CODE: "TEST1" });
    try {
      const on = await storefrontOrder(undefined, { ttclid: "E.C.P.abc123" });
      const row = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: on.id, consumer: "tiktok-events-purchase" } });
      expect(row.payload).toMatchObject({ orderId: on.id, context: { ttclid: "E.C.P.abc123" } });

      // An admin-entered order is not a website conversion.
      const phoneOrder = await createOrder(checkout([{ variantId, quantity: 1 }]), null, {});
      orderIds.push(phoneOrder.id);
      expect(await prisma.outboxEvent.count({ where: { aggregateId: phoneOrder.id, consumer: "tiktok-events-purchase" } })).toBe(0);
    } finally {
      restore();
    }
  });
});
