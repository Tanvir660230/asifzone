import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, RUN, stockOf, trackOrder } from "../../test-fixtures";
import { receiveReturnedParcel, reconcilePartialDelivery, updateOrderStatus } from "./order.service";
import { recordItemReturn } from "./order-adjustments.service";
import { reviewReturnRequest } from "../return-requests/return-request.service";

// Owner decision (Order Operations plan, M2): returned goods become sellable only after the parcel is physically received and
// inspected. Approving a return, Delivered → Returned, approving an exchange, reconciling a partial delivery and recording an
// item return each record the DECISION (OrderItem.returnedQuantity — what the money and sales figures read) and never move
// stock. Stock comes back once, through receiveReturnedParcel.

let admin: string;
beforeAll(async () => {
  admin = await ownerId();
});
const createdAdmins: string[] = [];
afterAll(async () => {
  if (createdAdmins.length) await prisma.adminUser.deleteMany({ where: { id: { in: createdAdmins } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function delivered(variantId: string, quantity: number) {
  const order = await placeOrder([{ variantId, quantity }]);
  for (const status of ["CONFIRMED", "SHIPPED", "DELIVERED"] as const) await updateOrderStatus(order.id, { status }, admin);
  return order;
}

async function lineOf(orderId: string) {
  return prisma.orderItem.findFirstOrThrow({ where: { orderId }, orderBy: { id: "asc" } });
}

async function returnMovements(orderId: string) {
  return prisma.stockMovement.count({ where: { orderId, reason: "RETURN" } });
}

describe("returned stock waits for the parcel", () => {
  it("Delivered → Returned records the return without restocking; receiving it restocks exactly once", async () => {
    const { variants } = await createStockedProduct({ stocks: [10] });
    const v = variants[0]!;
    const order = await delivered(v.id, 2);
    expect(await stockOf(v.id)).toBe(8);

    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);
    expect(await stockOf(v.id)).toBe(8);
    expect(await lineOf(order.id)).toMatchObject({ returnedQuantity: 2, restockedQuantity: 0 });
    expect(await returnMovements(order.id)).toBe(0);
    await assertInventoryInvariants(v.id);

    await receiveReturnedParcel(order.id, admin, {});
    expect(await stockOf(v.id)).toBe(10);
    expect(await lineOf(order.id)).toMatchObject({ returnedQuantity: 2, restockedQuantity: 2 });
    expect(await returnMovements(order.id)).toBe(1);
    await expect(receiveReturnedParcel(order.id, admin, {})).rejects.toMatchObject({ details: { code: "NOTHING_TO_RECEIVE" } });
    expect(await stockOf(v.id)).toBe(10);
    await assertInventoryInvariants(v.id);
  });

  it("approving a customer return changes no stock, refuses damage at approval, and damage is written off at receipt", async () => {
    const { variants } = await createStockedProduct({ stocks: [5] });
    const v = variants[0]!;
    const order = await delivered(v.id, 2);
    const line = await lineOf(order.id);
    const request = await prisma.returnRequest.create({ data: { orderId: order.id, customerId: order.customerId!, reason: "Too small", type: "RETURN" } });

    await expect(reviewReturnRequest(request.id, { status: "APPROVED", damaged: [{ orderItemId: line.id, quantity: 1 }] }, admin)).rejects.toMatchObject({
      details: { code: "DAMAGE_AT_RECEIPT" },
    });
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");

    await reviewReturnRequest(request.id, { status: "APPROVED" }, admin);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("RETURNED");
    expect(await stockOf(v.id)).toBe(3);

    await receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line.id, quantity: 2, damaged: 1 }], damageNote: "torn seam" });
    expect(await stockOf(v.id)).toBe(4); // one good unit back; the damaged one came back and went straight out
    const writeOffs = await prisma.stockMovement.findMany({ where: { sourceType: "OrderParcelReceipt", sourceId: order.id } });
    expect(writeOffs.map((m) => [m.reason, m.change])).toEqual([["DAMAGED", -1]]);
    await assertInventoryInvariants(v.id);
  });

  it("approving an exchange reserves the replacement but leaves the original unit off the shelf until it arrives", async () => {
    const { variants } = await createStockedProduct({ stocks: [4, 4] });
    const [a, b] = [variants[0]!, variants[1]!];
    const order = await delivered(a.id, 1);
    const line = await lineOf(order.id);
    const request = await prisma.returnRequest.create({
      data: { orderId: order.id, customerId: order.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: line.id, requestedVariantId: b.id },
    });
    await reviewReturnRequest(request.id, { status: "APPROVED" }, admin);
    trackOrder((await prisma.returnRequest.findUniqueOrThrow({ where: { id: request.id } })).exchangeOrderId!);

    expect(await stockOf(b.id)).toBe(3); // the replacement is reserved, as before
    expect(await stockOf(a.id)).toBe(3); // the original is still with the customer
    expect(await lineOf(order.id)).toMatchObject({ returnedQuantity: 1, restockedQuantity: 0 });

    await receiveReturnedParcel(order.id, admin, {});
    expect(await stockOf(a.id)).toBe(4);
    await assertInventoryInvariants(a.id);
    await assertInventoryInvariants(b.id);
  });

  it("reconciling a partial delivery records what came back but restocks only at receipt; damage waits for receipt", async () => {
    const { variants } = await createStockedProduct({ stocks: [6] });
    const v = variants[0]!;
    const order = await placeOrder([{ variantId: v.id, quantity: 3 }]);
    for (const status of ["CONFIRMED", "SHIPPED", "PARTIALLY_DELIVERED"] as const) await updateOrderStatus(order.id, { status }, admin);
    const line = await lineOf(order.id);

    await expect(reconcilePartialDelivery(order.id, { items: [{ orderItemId: line.id, returnedQuantity: 1, damaged: 1 }] }, admin)).rejects.toMatchObject({
      details: { code: "DAMAGE_AT_RECEIPT" },
    });
    await reconcilePartialDelivery(order.id, { items: [{ orderItemId: line.id, returnedQuantity: 1 }] }, admin);
    expect(await stockOf(v.id)).toBe(3);
    expect(await lineOf(order.id)).toMatchObject({ returnedQuantity: 1, restockedQuantity: 0 });

    await expect(receiveReturnedParcel(order.id, admin, { lines: [{ orderItemId: line.id, quantity: 2 }] })).rejects.toMatchObject({
      details: { code: "MORE_THAN_OUTSTANDING" },
    });
    await receiveReturnedParcel(order.id, admin, {});
    expect(await stockOf(v.id)).toBe(4);
    await assertInventoryInvariants(v.id);
  });

  it("a partial delivery where the customer kept nothing becomes Returned with no stock until the parcel is received", async () => {
    const { variants } = await createStockedProduct({ stocks: [4] });
    const v = variants[0]!;
    const order = await placeOrder([{ variantId: v.id, quantity: 2 }]);
    for (const status of ["CONFIRMED", "SHIPPED", "PARTIALLY_DELIVERED"] as const) await updateOrderStatus(order.id, { status }, admin);
    const line = await lineOf(order.id);

    const reconciled = await reconcilePartialDelivery(order.id, { items: [{ orderItemId: line.id, returnedQuantity: 2 }] }, admin);
    expect(reconciled.status).toBe("RETURNED");
    expect(await stockOf(v.id)).toBe(2);
    await receiveReturnedParcel(order.id, admin, {});
    expect(await stockOf(v.id)).toBe(4);
    await assertInventoryInvariants(v.id);
  });

  it("an item-level return records the decision and its store credit now, the stock at receipt", async () => {
    const { variants } = await createStockedProduct({ stocks: [5] });
    const v = variants[0]!;
    const order = await delivered(v.id, 2); // COD: delivered = paid, so a store credit has money to come from
    const line = await lineOf(order.id);

    await expect(
      recordItemReturn(order.id, { reason: "Wrong colour", compensation: "STORE_CREDIT", items: [{ orderItemId: line.id, quantity: 1, restock: false }] }, admin),
    ).rejects.toMatchObject({ details: { code: "DAMAGE_AT_RECEIPT" } });

    const request = await recordItemReturn(order.id, { reason: "Wrong colour", compensation: "STORE_CREDIT", items: [{ orderItemId: line.id, quantity: 1, restock: true }] }, admin);
    expect(Number(request.compensationAmount)).toBeGreaterThan(0); // the money decision is not held back by the parcel
    expect(await stockOf(v.id)).toBe(3);
    expect(await lineOf(order.id)).toMatchObject({ returnedQuantity: 1, restockedQuantity: 0 });

    // The same unit can't be returned twice while it is on its way back.
    await expect(recordItemReturn(order.id, { reason: "Again", compensation: "NONE", items: [{ orderItemId: line.id, quantity: 2, restock: true }] }, admin)).rejects.toMatchObject({
      details: { code: "RETURN_EXCEEDS_OUTSTANDING" },
    });

    await receiveReturnedParcel(order.id, admin, {});
    expect(await stockOf(v.id)).toBe(4);
    await assertInventoryInvariants(v.id);
  });

  it("two people receiving the same returned parcel at once restock it once", async () => {
    const { variants } = await createStockedProduct({ stocks: [5] });
    const v = variants[0]!;
    const order = await delivered(v.id, 1);
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);

    const results = await Promise.allSettled([receiveReturnedParcel(order.id, admin, {}), receiveReturnedParcel(order.id, admin, {})]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stockOf(v.id)).toBe(5);
    expect(await returnMovements(order.id)).toBe(1);
    await assertInventoryInvariants(v.id);
  });

  it("a delivered order with nothing decided as returned has nothing to receive", async () => {
    const { variants } = await createStockedProduct({ stocks: [3] });
    const order = await delivered(variants[0]!.id, 1);
    await expect(receiveReturnedParcel(order.id, admin, {})).rejects.toMatchObject({ details: { code: "NOTHING_TO_RECEIVE" } });
    expect(await stockOf(variants[0]!.id)).toBe(2);
  });

  it("a courier's cancelled or partial report after shipping never restocks on its own", async () => {
    const { variants } = await createStockedProduct({ stocks: [4] });
    const v = variants[0]!;
    const cancelled = await placeOrder([{ variantId: v.id, quantity: 1 }]);
    await updateOrderStatus(cancelled.id, { status: "SHIPPED" }, admin);
    await updateOrderStatus(cancelled.id, { status: "CANCELLED", note: "Steadfast delivery status: cancelled" });
    const partial = await placeOrder([{ variantId: v.id, quantity: 1 }]);
    await updateOrderStatus(partial.id, { status: "SHIPPED" }, admin);
    await updateOrderStatus(partial.id, { status: "PARTIALLY_DELIVERED", note: "Steadfast delivery status: partial_delivered" });
    expect(await stockOf(v.id)).toBe(2);
    await assertInventoryInvariants(v.id);
  });

  it("receiving a parcel back takes the returns permission: a role without it is refused and nothing moves", async () => {
    const { variants } = await createStockedProduct({ stocks: [5] });
    const v = variants[0]!;
    const order = await delivered(v.id, 1);
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);
    const as = async (role: "ACCOUNTANT" | "STAFF") => {
      const a = await prisma.adminUser.create({ data: { name: `Receipt ${role}`, email: `receipt-${role.toLowerCase()}-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role } });
      createdAdmins.push(a.id);
      const csrf = "receipt-csrf";
      return request(app)
        .post(`/api/orders/${order.id}/receive-return`)
        .set("Cookie", [`access_token=${signAccessToken({ adminId: a.id, role })}`, `csrf_token=${csrf}`])
        .set("X-CSRF-Token", csrf)
        .send({});
    };
    expect((await as("ACCOUNTANT")).status).toBe(403);
    expect(await stockOf(v.id)).toBe(4);
    expect((await as("STAFF")).status).toBe(200); // the store team keeps the workflow
    expect(await stockOf(v.id)).toBe(5);
    await assertInventoryInvariants(v.id);
  });
});
