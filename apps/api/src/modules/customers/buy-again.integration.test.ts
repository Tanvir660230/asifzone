import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { listBuyAgainProductIds } from "./customer.service";

// "Buy again" on the homepage: the products a signed-in customer has received, newest delivery first, each once —
// never an order that is still on its way, was cancelled or returned.

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function orderFor(phone: string, variantIds: string[]) {
  const order = await createManualOrder(
    {
      items: variantIds.map((variantId) => ({ variantId, quantity: 1 })),
      customerName: "Vitest Buy Again",
      customerPhone: phone,
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
    } as never,
    await ownerId(),
  );
  trackOrder(order.id);
  return prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { id: true, customerId: true } });
}

describe("listBuyAgainProductIds", () => {
  it("lists delivered products once, the latest delivery first, and skips undelivered orders", async () => {
    const phone = "01712345671";
    const a = await createStockedProduct({ stocks: [5, 5] });
    const b = await createStockedProduct({ stocks: [5] });
    const pending = await createStockedProduct({ stocks: [5] });

    const first = await orderFor(phone, [a.variants[0]!.id, a.variants[1]!.id]);
    const second = await orderFor(phone, [b.variants[0]!.id]);
    await orderFor(phone, [pending.variants[0]!.id]);
    await prisma.order.update({ where: { id: first.id }, data: { status: "DELIVERED", createdAt: new Date("2026-01-01") } });
    await prisma.order.update({ where: { id: second.id }, data: { status: "DELIVERED", createdAt: new Date("2026-02-01") } });

    const ids = await listBuyAgainProductIds(first.customerId!);
    expect(ids).toEqual([b.product.id, a.product.id]);
  });

  it("is empty for a customer with nothing delivered", async () => {
    const order = await orderFor("01712345672", [(await createStockedProduct({ stocks: [5] })).variants[0]!.id]);
    expect(await listBuyAgainProductIds(order.customerId!)).toEqual([]);
  });
});
