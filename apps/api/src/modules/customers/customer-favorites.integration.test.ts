import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { getCustomerDetailAdmin } from "./customer.service";

// A customer's favourite products are counted per product, not per size/colour (SKU): two sizes of one cap are one
// favourite with both units — and each row carries the product id (unique React key, link to the product).

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("customer favourite products", () => {
  it("adds up the variants of one product", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [5, 5] });
    const order = await createManualOrder(
      {
        items: [
          { variantId: variants[0]!.id, quantity: 1 },
          { variantId: variants[1]!.id, quantity: 2 },
        ],
        customerName: "Vitest Favourites",
        customerPhone: "01712345688",
        shippingDivision: "Dhaka",
        shippingDistrict: "Dhaka",
        shippingArea: "Uttara",
        shippingAddressLine: "House 1",
        paymentMethod: "COD",
      } as never,
      await ownerId(),
    );
    trackOrder(order.id);
    const customerId = (await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { customerId: true } })).customerId!;
    const detail = await getCustomerDetailAdmin(customerId);
    const rows = detail.favoriteProducts.filter((f) => f.productId === product.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe(3);
  });
});
