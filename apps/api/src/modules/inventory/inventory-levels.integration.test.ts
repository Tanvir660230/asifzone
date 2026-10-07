import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";
import { listStockLevels } from "./inventory-levels.service";

// Blueprint V2 §O: available = ProductVariant.stock, reserved = units on unshipped orders, on hand = available + reserved.

let admin: string;
beforeAll(async () => {
  admin = await ownerId();
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function row(variantId: string, sku: string) {
  const result = await listStockLevels({ search: sku, page: 1, pageSize: 50, sort: "attention" });
  return result.items.find((r) => r.variantId === variantId)!;
}

describe("stock levels", () => {
  it("follows an order: reserved while unshipped, gone from on hand once shipped", async () => {
    const { variants } = await createStockedProduct({ stocks: [10], basePrice: 500 });
    const v = variants[0]!;
    const sku = (await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id }, select: { sku: true } })).sku;

    expect(await row(v.id, sku)).toMatchObject({ available: 10, reserved: 0, onHand: 10 });

    const order = await placeOrder([{ variantId: v.id, quantity: 2 }]);
    expect(await row(v.id, sku)).toMatchObject({ available: 8, reserved: 2, onHand: 10 });

    await updateOrderStatus(order.id, { status: "SHIPPED" }, admin);
    expect(await row(v.id, sku)).toMatchObject({ available: 8, reserved: 0, onHand: 8 });
  });

  it("a cancelled order gives its units back to available, not to reserved", async () => {
    const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
    const v = variants[0]!;
    const sku = (await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id }, select: { sku: true } })).sku;
    const order = await placeOrder([{ variantId: v.id, quantity: 3 }]);
    await updateOrderStatus(order.id, { status: "CANCELLED", note: "test" }, admin);
    expect(await row(v.id, sku)).toMatchObject({ available: 5, reserved: 0, onHand: 5 });
  });

  it("states and the out-of-stock-first default order follow the shared stock rule", async () => {
    const { variants } = await createStockedProduct({ stocks: [0, 2, 50], basePrice: 500 });
    const result = await listStockLevels({ page: 1, pageSize: 100, sort: "attention" });
    const mine = result.items.filter((r) => variants.some((v) => v.id === r.variantId));
    expect(mine.map((r) => r.state)).toEqual(["OUT_OF_STOCK", "LOW_STOCK", "IN_STOCK"]);
    expect(result.counts.ALL).toBeGreaterThanOrEqual(3);
  });

  it("GET /api/inventory/levels serves it to an admin with inventory.read", async () => {
    const res = await (await asOwner()).get("/api/inventory/levels?state=OUT_OF_STOCK&pageSize=5");
    expect(res.status).toBe(200);
    expect(res.body.items.every((r: { state: string }) => r.state === "OUT_OF_STOCK")).toBe(true);
  });
});
