import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { ORDER_QUEUE_FILTERS, holdKeepsStock, placeOrderHoldSchema } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf } from "../../test-fixtures";
import { recordManualPayment } from "../../domain/payments/payment-ledger.service";
import { bookOrderWithSteadfast } from "../courier/courier.service";
import { deleteOrder, listOrders, restoreOrder, updateOrderStatus } from "./order.service";
import { endOrderHold, placeOrderHold } from "./order-hold.service";
import { claimNextConfirmation, recordConfirmationAttempt } from "./confirmation.service";

// Order hold (docs/ORDER_HOLD.md). Owner decisions 2026-11-22: a hold needs a reason and a date; only a first hold of a
// day or less, or one secured with an advance (up to 7 days), keeps the stock — every other hold gives it back to sell at
// once, and ending the hold takes it back (refused when it was sold meanwhile). A held order is never called, booked,
// packed or changed; nothing ends a hold on its own.

const CSRF = "vitest-csrf";
const HOUR = 3_600_000;
let owner: string;
let staff: string;

function agent(adminId: string, role: "OWNER" | "STAFF") {
  const cookie = [`access_token=${signAccessToken({ adminId, role })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return { post: (url: string, body: object = {}) => auth(request(app).post(url)).send(body) };
}

beforeAll(async () => {
  owner = await ownerId();
  const hash = await bcrypt.hash("x", 4);
  staff = (await prisma.adminUser.create({ data: { name: "Hold caller", email: `hold-${Date.now().toString(36)}@example.com`, passwordHash: hash, role: "STAFF" } })).id;
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.adminUser.deleteMany({ where: { id: staff } });
  await prisma.$disconnect();
});

async function orderOf(stock: number, quantity = 1) {
  const { variants } = await createStockedProduct({ stocks: [stock], basePrice: 900 });
  const variantId = variants[0]!.id;
  const order = await placeOrder([{ variantId, quantity }]);
  return { order, variantId };
}
const row = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
const inFuture = (hours: number) => new Date(Date.now() + hours * HOUR);
async function inQueue(q: keyof typeof ORDER_QUEUE_FILTERS, orderId: string) {
  const { orderNumber } = await row(orderId);
  return (await listOrders({ ...ORDER_QUEUE_FILTERS[q], search: orderNumber, page: 1, pageSize: 25 } as never)).items.some((o) => o.id === orderId);
}

describe("the stock rule", () => {
  it("keeps stock only for a first hold of a day, or an advance-secured hold up to a week", () => {
    const now = new Date("2026-11-22T06:00:00Z");
    const at = (h: number) => new Date(now.getTime() + h * HOUR);
    expect(holdKeepsStock({ until: at(24), now, previousHolds: 0, advancePaid: false })).toBe(true);
    expect(holdKeepsStock({ until: at(25), now, previousHolds: 0, advancePaid: false })).toBe(false);
    expect(holdKeepsStock({ until: at(10), now, previousHolds: 1, advancePaid: false })).toBe(false);
    expect(holdKeepsStock({ until: at(7 * 24), now, previousHolds: 1, advancePaid: true })).toBe(true);
    expect(holdKeepsStock({ until: at(7 * 24 + 1), now, previousHolds: 0, advancePaid: true })).toBe(false);
  });

  it("a reason and a date are required; 'Other' needs a note", () => {
    expect(placeOrderHoldSchema.safeParse({ reason: "AFTER_PAYDAY" }).success).toBe(false);
    expect(placeOrderHoldSchema.safeParse({ reason: "OTHER", until: inFuture(5) }).success).toBe(false);
    expect(placeOrderHoldSchema.safeParse({ reason: "OTHER", until: inFuture(5), note: "family wedding" }).success).toBe(true);
  });
});

describe("placing a hold", () => {
  it("a one-day hold keeps the stock and takes the order out of the call queues", async () => {
    const { order, variantId } = await orderOf(5);
    expect(await stockOf(variantId)).toBe(4);
    expect(await inQueue("callNow", order.id)).toBe(true);

    const until = inFuture(20);
    const res = await agent(staff, "STAFF").post(`/api/orders/${order.id}/order-hold`, { reason: "AWAY", until: until.toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({ status: "PENDING", holdReason: "AWAY", holdStockReleased: false, holdCount: 1 });
    expect(await stockOf(variantId)).toBe(4);
    expect(await inQueue("callNow", order.id)).toBe(false);
    expect(await inQueue("callLater", order.id)).toBe(false);
    expect(await inQueue("onHold", order.id)).toBe(true);
    expect(await prisma.orderHold.count({ where: { orderId: order.id, endedAt: null } })).toBe(1);
    const last = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
    expect(last.note).toContain("stock kept");
  });

  it("a longer hold without an advance gives the stock back at once — another buyer can have it", async () => {
    const { order, variantId } = await orderOf(1);
    expect(await stockOf(variantId)).toBe(0);
    await placeOrderHold(order.id, { reason: "AFTER_PAYDAY", until: inFuture(72) }, staff);
    expect(await stockOf(variantId)).toBe(1);
    expect((await row(order.id)).holdStockReleased).toBe(true);
    await assertInventoryInvariants(variantId);

    // The shelf unit sells to someone else.
    const other = await placeOrder([{ variantId, quantity: 1 }]);
    expect(await stockOf(variantId)).toBe(0);

    // Ending the hold now is refused and changes nothing.
    await expect(endOrderHold(order.id, staff)).rejects.toMatchObject({ statusCode: 409, details: { code: "HOLD_SOLD_OUT" } });
    expect((await row(order.id)).holdUntil).not.toBeNull();
    // Confirming it is refused the same way.
    await expect(updateOrderStatus(order.id, { status: "CONFIRMED" }, staff)).rejects.toMatchObject({ statusCode: 409 });
    expect((await row(order.id)).status).toBe("PENDING");

    // The other buyer cancels: the unit is back, and ending the hold takes it.
    await updateOrderStatus(other.id, { status: "CANCELLED", note: "changed mind" }, owner);
    await endOrderHold(order.id, staff);
    expect(await stockOf(variantId)).toBe(0);
    const after = await row(order.id);
    expect(after).toMatchObject({ holdUntil: null, holdStockReleased: false, followUpAt: null });
    expect(await inQueue("callNow", order.id)).toBe(true);
    expect((await prisma.orderHold.findFirstOrThrow({ where: { orderId: order.id } })).outcome).toBe("RESUMED");
    await assertInventoryInvariants(variantId);
  });

  it("an advance keeps the stock for a hold up to a week", async () => {
    const { order, variantId } = await orderOf(3);
    await recordManualPayment(order.id, { amount: Number(order.shippingFee) || 100, kind: "MANUAL" }, owner);
    await placeOrderHold(order.id, { reason: "ON_A_DATE", until: inFuture(5 * 24) }, staff);
    expect(await stockOf(variantId)).toBe(2);
    expect((await row(order.id)).holdStockReleased).toBe(false);
  });

  it("refuses a past date, more than 30 days, a booked order and a second open hold", async () => {
    const { order } = await orderOf(3);
    await expect(placeOrderHold(order.id, { reason: "AWAY", until: new Date(Date.now() - 1000) }, staff)).rejects.toMatchObject({ statusCode: 400 });
    await expect(placeOrderHold(order.id, { reason: "AWAY", until: inFuture(31 * 24) }, staff)).rejects.toMatchObject({ statusCode: 400 });
    await placeOrderHold(order.id, { reason: "AWAY", until: inFuture(10) }, staff);
    await expect(placeOrderHold(order.id, { reason: "AWAY", until: inFuture(10) }, staff)).rejects.toMatchObject({ statusCode: 409 });

    const booked = await orderOf(3);
    await prisma.order.update({ where: { id: booked.order.id }, data: { courierConsignmentId: `hold-${booked.order.id}` } });
    await expect(placeOrderHold(booked.order.id, { reason: "AWAY", until: inFuture(10) }, staff)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("a third hold needs an owner or manager", async () => {
    const { order } = await orderOf(3);
    for (let i = 0; i < 2; i++) {
      await placeOrderHold(order.id, { reason: "DECIDING", until: inFuture(48) }, staff);
      await endOrderHold(order.id, staff);
    }
    const res = await agent(staff, "STAFF").post(`/api/orders/${order.id}/order-hold`, { reason: "DECIDING", until: inFuture(48).toISOString() });
    expect(res.status).toBe(409);
    const ok = await agent(owner, "OWNER").post(`/api/orders/${order.id}/order-hold`, { reason: "DECIDING", until: inFuture(48).toISOString() });
    expect(ok.status).toBe(200);
    expect(ok.body.order.holdCount).toBe(3);
  });
});

describe("a held order is never moved forward", () => {
  it("can't be booked, packed or changed; Ready to book leaves it out", async () => {
    const { order, variantId } = await orderOf(3);
    await updateOrderStatus(order.id, { status: "CONFIRMED" }, staff);
    expect(await inQueue("readyToBook", order.id)).toBe(true);
    await placeOrderHold(order.id, { reason: "AFTER_PAYDAY", until: inFuture(12) }, staff);
    expect(await inQueue("readyToBook", order.id)).toBe(false);
    await expect(bookOrderWithSteadfast(order.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(updateOrderStatus(order.id, { status: "PROCESSING" }, staff)).rejects.toMatchObject({ statusCode: 409 });
    const edit = await agent(owner, "OWNER").post(`/api/orders/${order.id}/modifications`, { items: [{ variantId, quantity: 2 }] });
    expect(edit.status).toBe(409);
    expect(edit.body.message ?? edit.body.error).toMatch(/on hold/);

    await endOrderHold(order.id, staff);
    expect(await inQueue("readyToBook", order.id)).toBe(true);
  });

  it("is not called while held, and comes back to Call now on its date — not escalated by age", async () => {
    const { order } = await orderOf(3);
    await prisma.order.update({ where: { id: order.id }, data: { createdAt: new Date(Date.now() - 80 * HOUR) } });
    await placeOrderHold(order.id, { reason: "AWAY", until: inFuture(30) }, staff);
    expect(await inQueue("confirmEscalated", order.id)).toBe(false);
    expect(await inQueue("needsAction", order.id)).toBe(false);

    // The date comes.
    await prisma.order.update({ where: { id: order.id }, data: { holdUntil: new Date(Date.now() - 1000), followUpAt: new Date(Date.now() - 1000) } });
    expect(await inQueue("callNow", order.id)).toBe(true);
    expect(await inQueue("confirmEscalated", order.id)).toBe(false);
    expect(await inQueue("needsAction", order.id)).toBe(true);
    // Still on hold until a person ends it.
    expect((await row(order.id)).holdUntil).not.toBeNull();
  });

  it("Take next call never hands out an order whose hold is still running", async () => {
    const { order } = await orderOf(3);
    await placeOrderHold(order.id, { reason: "AWAY", until: inFuture(30) }, staff);
    for (let i = 0; i < 50; i++) {
      const next = await claimNextConfirmation(staff);
      if (!next) break;
      expect(next.orderId).not.toBe(order.id);
      await prisma.order.update({ where: { id: next.orderId }, data: { confirmationClaimedById: null, confirmationClaimedAt: null, followUpAt: inFuture(1) } });
    }
  });
});

describe("ending a hold", () => {
  it("confirming on the call takes the stock back and ends the hold", async () => {
    const { order, variantId } = await orderOf(2);
    await placeOrderHold(order.id, { reason: "AFTER_PAYDAY", until: inFuture(72) }, staff);
    expect(await stockOf(variantId)).toBe(2);
    await recordConfirmationAttempt(order.id, staff, { outcome: "CONFIRMED" }, { canCancel: false });
    const after = await row(order.id);
    expect(after).toMatchObject({ status: "CONFIRMED", holdUntil: null, holdStockReleased: false });
    expect(await stockOf(variantId)).toBe(1);
    expect((await prisma.orderHold.findFirstOrThrow({ where: { orderId: order.id } })).outcome).toBe("CONFIRMED");
    await assertInventoryInvariants(variantId);
  });

  it("cancelling a held order never gives the stock back twice", async () => {
    const { order, variantId } = await orderOf(2);
    await placeOrderHold(order.id, { reason: "DECIDING", until: inFuture(72) }, staff);
    expect(await stockOf(variantId)).toBe(2);
    await updateOrderStatus(order.id, { status: "CANCELLED", note: "decided not to" }, owner);
    expect(await stockOf(variantId)).toBe(2);
    expect((await row(order.id)).holdUntil).toBeNull();
    expect((await prisma.orderHold.findFirstOrThrow({ where: { orderId: order.id } })).outcome).toBe("CANCELLED");
    await assertInventoryInvariants(variantId);
  });

  it("Trash ends the hold; restoring takes the full stock back once", async () => {
    const { order, variantId } = await orderOf(2);
    await placeOrderHold(order.id, { reason: "AWAY", until: inFuture(72) }, staff);
    await deleteOrder(order.id, owner);
    expect(await stockOf(variantId)).toBe(2);
    expect((await row(order.id)).holdUntil).toBeNull();
    await restoreOrder(order.id, owner);
    expect(await stockOf(variantId)).toBe(1);
    await assertInventoryInvariants(variantId);
  });

  it("ending twice is harmless", async () => {
    const { order, variantId } = await orderOf(2);
    await placeOrderHold(order.id, { reason: "AWAY", until: inFuture(72) }, staff);
    await Promise.all([endOrderHold(order.id, staff), endOrderHold(order.id, staff)]);
    expect(await stockOf(variantId)).toBe(1);
    await assertInventoryInvariants(variantId);
  });
});
