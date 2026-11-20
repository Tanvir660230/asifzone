import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";

// Chat to order (2026-11-20): staff create an order from an Inbox conversation; the order remembers the chat, the chat
// lists its orders, and the Inbox says how many chats became orders.

const RUN = Date.now().toString(36);
let admin: string;
const conversationIds: string[] = [];

beforeAll(async () => {
  admin = await ownerId();
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.$disconnect();
});

async function chat(channel: "MESSENGER" | "WHATSAPP", name: string) {
  const c = await prisma.conversation.create({
    data: { channel, subject: `Chat ${name} ${RUN}`, contactName: name, externalThreadId: `t-${name}-${RUN}`, lastInboundAt: new Date() },
  });
  conversationIds.push(c.id);
  return c;
}

async function orderFrom(conversationId: string | undefined, phone: string) {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  const order = await createManualOrder(
    {
      items: [{ variantId: variants[0]!.id, quantity: 1 }],
      customerName: "Chat Buyer",
      customerPhone: phone,
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
      conversationId,
    } as never,
    admin,
  );
  trackOrder(order.id);
  return order;
}

describe("chat to order", () => {
  it("an order made from a chat is linked to it, and the chat lists it", async () => {
    const owner = await asOwner();
    const c = await chat("MESSENGER", "Rafi");
    const order = await orderFrom(c.id, "01712345681");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).conversationId).toBe(c.id);

    const detail = await owner.get(`/api/v1/admin/conversations/${c.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.orders).toEqual([expect.objectContaining({ id: order.id, orderNumber: order.orderNumber, status: order.status })]);
  });

  it("an unknown conversation id is refused and no order is made", async () => {
    const before = await prisma.order.count();
    await expect(orderFrom("ckz0000000000000000000000", "01712345682")).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.order.count()).toBe(before);
  });

  it("the Inbox counts chats that became orders, per channel", async () => {
    const owner = await asOwner();
    const before = (await owner.get("/api/v1/admin/conversations/conversion?days=30")).body;
    const a = await chat("WHATSAPP", "Nila");
    await chat("WHATSAPP", "Tuli");
    await orderFrom(a.id, "01712345683");
    await orderFrom(a.id, "01712345683");

    const res = await owner.get("/api/v1/admin/conversations/conversion?days=30");
    expect(res.status).toBe(200);
    const was = before.channels.find((r: { channel: string }) => r.channel === "WHATSAPP") ?? { chats: 0, chatsWithOrder: 0, orders: 0 };
    const now = res.body.channels.find((r: { channel: string }) => r.channel === "WHATSAPP");
    expect(now.chats - was.chats).toBe(2);
    expect(now.chatsWithOrder - was.chatsWithOrder).toBe(1);
    expect(now.orders - was.orders).toBe(2);
    expect(res.body.days).toBe(30);
  });
});
