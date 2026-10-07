import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "./order.service";

// Owner decision D24 (docs/BUSINESS_DECISIONS.md): a phone order staff enter is confirmed on that call — created
// CONFIRMED in the insert's own transaction, attributed to the admin; without the flag it stays PENDING as before.

let admin: string;
beforeAll(async () => {
  admin = await ownerId();
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function manualOrder(extra: Record<string, unknown>) {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  const order = await createManualOrder(
    {
      items: [{ variantId: variants[0]!.id, quantity: 1 }],
      customerName: "Vitest Phone Order",
      customerPhone: "01712345671",
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
      ...extra,
    } as never,
    admin,
  );
  trackOrder(order.id);
  return order;
}

describe("manual order — confirm on create (D24)", () => {
  it("confirmNow creates the order CONFIRMED, with the move on its timeline by that admin", async () => {
    const order = await manualOrder({ confirmNow: true });
    expect(order.status).toBe("CONFIRMED");
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.status)).toEqual(["PENDING", "CONFIRMED"]);
    expect(history[1]!.changedByAdminId).toBe(admin);
  });

  it("without confirmNow the order stays PENDING", async () => {
    const order = await manualOrder({});
    expect(order.status).toBe("PENDING");
  });

  it("confirming on create still reserves stock exactly once", async () => {
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
    const order = await createManualOrder(
      {
        items: [{ variantId: variants[0]!.id, quantity: 2 }],
        customerName: "Vitest Phone Order",
        customerPhone: "01712345672",
        shippingDivision: "Dhaka",
        shippingDistrict: "Dhaka",
        shippingArea: "Uttara",
        shippingAddressLine: "House 1",
        paymentMethod: "COD",
        confirmNow: true,
      } as never,
      admin,
    );
    trackOrder(order.id);
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variants[0]!.id }, select: { stock: true } });
    expect(variant.stock).toBe(3);
  });
});
