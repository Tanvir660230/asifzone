import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import {
  asOwner,
  assertInventoryInvariants,
  cleanupFixtures,
  createStockedProduct,
  ledgerSum,
  ownerId,
  placeOrder,
  stockOf,
  trackOrder,
} from "../../test-fixtures";
import { deleteOrder, restoreOrder, updateOrderStatus } from "../orders/order.service";
import { reviewReturnRequest } from "../return-requests/return-request.service";
import { updateProduct } from "../products/product.service";
import { adjustVariantStock, recordInitialStock } from "./inventory.service";

// docs/INVENTORY_INVARIANTS.md — current stock = opening stock + every valid movement, after every kind of change.

let admin: string;
beforeAll(async () => {
  admin = await ownerId();
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("inventory ledger reconciliation", () => {
  it("stock equals opening stock + Σ movements after sales, cancellations, returns, exchanges, write-offs, edits, imports, trash and restore", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [10, 5] });
    const [v, w] = [variants[0]!, variants[1]!];
    const opening = 10;
    const check = async (expected: number) => {
      expect(await stockOf(v.id)).toBe(expected);
      await assertInventoryInvariants(v.id);
      await assertInventoryInvariants(w.id);
    };
    await check(10);

    // sale → cancellation
    const a = await placeOrder([{ variantId: v.id, quantity: 2 }]);
    await check(8);
    await updateOrderStatus(a.id, { status: "CANCELLED" }, admin);
    await check(10);

    // sale → delivery → return
    const b = await placeOrder([{ variantId: v.id, quantity: 3 }]);
    await updateOrderStatus(b.id, { status: "DELIVERED" }, admin);
    await check(7);
    await updateOrderStatus(b.id, { status: "RETURNED" }, admin);
    await check(10);

    // exchange: v comes back, w goes out on a new order
    const c = await placeOrder([{ variantId: v.id, quantity: 1 }]);
    await updateOrderStatus(c.id, { status: "DELIVERED" }, admin);
    await check(9);
    const cLine = await prisma.orderItem.findFirstOrThrow({ where: { orderId: c.id } });
    const exchange = await prisma.returnRequest.create({
      data: { orderId: c.id, customerId: c.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: cLine.id, requestedVariantId: w.id },
    });
    await reviewReturnRequest(exchange.id, { status: "APPROVED" }, admin);
    const exchangeOrderId = (await prisma.returnRequest.findUniqueOrThrow({ where: { id: exchange.id } })).exchangeOrderId!;
    trackOrder(exchangeOrderId);
    await check(10);
    expect(await stockOf(w.id)).toBe(4);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: cLine.id } })).returnedQuantity).toBe(1);

    // manual restock and write-offs
    await adjustVariantStock(v.id, 5, "RESTOCK", admin, "Supplier delivery");
    await adjustVariantStock(v.id, -2, "DAMAGED", admin, "Torn seams");
    await adjustVariantStock(v.id, -1, "LOST", admin, "Stock take shortfall");
    await check(12);
    await expect(adjustVariantStock(v.id, 1, "DAMAGED", admin)).rejects.toThrow(/negative/);
    await expect(adjustVariantStock(v.id, -100, "ADJUSTMENT", admin)).rejects.toThrow(/below zero/);
    await check(12);

    // product-form edit (fresh) — compare-and-set applies the difference
    const both = (vStock: number, vExpected: number | undefined, wStock = 4, wExpected: number | undefined = 4) => ({
      variants: [
        { id: v.id, sku: v.sku, size: v.size, color: v.color, stock: vStock, ...(vExpected !== undefined ? { expectedStock: vExpected } : {}) },
        { id: w.id, sku: w.sku, size: w.size, color: w.color, stock: wStock, ...(wExpected !== undefined ? { expectedStock: wExpected } : {}) },
      ],
    });
    await updateProduct(product.id, both(20, 12) as never, admin);
    await check(20);

    // import: a declared count
    await updateProduct(product.id, both(7, undefined, 4, undefined) as never, admin, undefined, { stockMode: "count" });
    await check(7);
    expect(await prisma.stockMovement.count({ where: { variantId: v.id, reason: "IMPORT" } })).toBe(1);

    // trash a pending order (release) and restore it (re-reserve)
    const d = await placeOrder([{ variantId: v.id, quantity: 2 }]);
    await check(5);
    await deleteOrder(d.id, admin);
    await check(7);
    await restoreOrder(d.id, admin);
    await check(5);

    // opening + Σ movements after the opening row
    const movements = await prisma.stockMovement.findMany({ where: { variantId: v.id }, orderBy: { createdAt: "asc" } });
    expect(movements[0]!.change).toBe(opening);
    expect(opening + movements.slice(1).reduce((sum, m) => sum + m.change, 0)).toBe(await stockOf(v.id));
    expect(new Set(movements.map((m) => m.reason))).toEqual(new Set(["RESTOCK", "ORDER", "CANCELLATION", "RETURN", "DAMAGED", "LOST", "ADJUSTMENT", "IMPORT"]));
  });

  describe("stale product forms cannot overwrite concurrent stock changes", () => {
    it("saving an untouched stale form keeps the sale that happened meanwhile (10 → order takes 2 → stays 8)", async () => {
      const { product, variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      await placeOrder([{ variantId: v.id, quantity: 2 }]);
      // The admin loaded the form at 10 and saves it without touching stock.
      const res = await (await asOwner()).patch(`/api/products/${product.id}`, {
        variants: [{ id: v.id, sku: v.sku, size: v.size, color: v.color, stock: 10, expectedStock: 10 }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await stockOf(v.id)).toBe(8); // the old code wrote 10 back, un-selling two units
      await assertInventoryInvariants(v.id);
    });

    it("a stale form that DID change stock is refused with 409, not applied", async () => {
      const { product, variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      await placeOrder([{ variantId: v.id, quantity: 2 }]);
      const res = await (await asOwner()).patch(`/api/products/${product.id}`, {
        variants: [{ id: v.id, sku: v.sku, size: v.size, color: v.color, stock: 15, expectedStock: 10 }],
      });
      expect(res.status).toBe(409);
      expect(await stockOf(v.id)).toBe(8);
    });

    it("a client that sends no expectedStock may only resend the current value", async () => {
      const { product, variants } = await createStockedProduct({ stocks: [6] });
      const v = variants[0]!;
      const owner = await asOwner();
      const same = await owner.patch(`/api/products/${product.id}`, { variants: [{ id: v.id, sku: v.sku, size: v.size, color: v.color, stock: 6 }] });
      expect(same.status).toBe(200);
      const overwrite = await owner.patch(`/api/products/${product.id}`, { variants: [{ id: v.id, sku: v.sku, size: v.size, color: v.color, stock: 60 }] });
      expect(overwrite.status).toBe(409);
      expect(await stockOf(v.id)).toBe(6);
    });

    it("two autosaves racing with the same edit apply it once", async () => {
      const { product, variants } = await createStockedProduct({ stocks: [10] });
      const v = variants[0]!;
      const owner = await asOwner();
      const body = { variants: [{ id: v.id, sku: v.sku, size: v.size, color: v.color, stock: 14, expectedStock: 10 }] };
      const results = await Promise.all([owner.patch(`/api/products/${product.id}`, body), owner.patch(`/api/products/${product.id}`, body)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await stockOf(v.id)).toBe(14);
      expect(await ledgerSum(v.id)).toBe(14);
    });
  });

  it("manual adjustment API: write-off reasons are admin-selectable, system reasons are not", async () => {
    const { variants } = await createStockedProduct({ stocks: [5] });
    const owner = await asOwner();
    expect((await owner.post(`/api/inventory/variants/${variants[0]!.id}/adjust`, { delta: -1, reason: "DAMAGED" })).status).toBe(200);
    expect((await owner.post(`/api/inventory/variants/${variants[0]!.id}/adjust`, { delta: 1, reason: "LOST" })).status).toBe(400);
    expect((await owner.post(`/api/inventory/variants/${variants[0]!.id}/adjust`, { delta: 1, reason: "CANCELLATION" })).status).toBe(400);
    expect(await stockOf(variants[0]!.id)).toBe(4);
  });
});

describe("stock-write timestamps (Phase 1 raw SQL vs Prisma)", () => {
  it("a stock change stamps ProductVariant.updatedAt in UTC, like Prisma's @updatedAt — whatever the DB session timezone", async () => {
    const { variants } = await createStockedProduct({ stocks: [1] });
    const id = variants[0]!.id;
    const before = Date.now();
    await prisma.$transaction(async (tx) => {
      // Pin the session to the production timezone so the check doesn't depend on the server's setting.
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'Asia/Dhaka'`);
      await recordInitialStock(tx, id, 2, "RESTOCK");
    });
    const after = Date.now();
    const raw = (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).updatedAt.getTime();
    // Read back through Prisma (UTC) it is "now" — the old bare NOW() read back 6 hours in the future.
    expect(raw).toBeGreaterThanOrEqual(before - 2_000);
    expect(raw).toBeLessThanOrEqual(after + 2_000);
    // …and a later Prisma write is later on the same clock (the two writers agree on ordering).
    await prisma.productVariant.update({ where: { id }, data: { sizeLabel: "M" } });
    const prismaStamp = (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).updatedAt.getTime();
    expect(prismaStamp).toBeGreaterThanOrEqual(raw);
    expect(prismaStamp - raw).toBeLessThan(60_000);
    expect(await stockOf(id)).toBe(3); // stock arithmetic unchanged
  });
});
