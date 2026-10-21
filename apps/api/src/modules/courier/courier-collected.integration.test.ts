import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Steadfast's status API is replaced: each test says what Steadfast's own record of the parcel is.
const courier = vi.hoisted(() => ({ status: "partial_delivered" }));
vi.mock("../../providers/courier/steadfast", () => ({
  createSteadfastConsignment: vi.fn(),
  createBulkSteadfastConsignments: vi.fn(),
  getSteadfastBalance: vi.fn(async () => 0),
  getSteadfastFraudCheck: vi.fn(async () => { throw new Error("no courier in tests"); }),
  getSteadfastStatusByConsignmentId: vi.fn(async () => courier.status),
}));
import request from "supertest";
import { app } from "../../app";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { reconcilePartialDelivery, updateOrderStatus } from "../orders/order.service";
import { getOrderPaymentSummary, recordManualPayment } from "../../domain/payments/payment-ledger.service";
import { handleSteadfastWebhook } from "./courier.service";
import { parseSteadfastWebhook } from "./steadfast-webhook";

// docs/PAYMENT_LEDGER.md §5b — what Steadfast reports the rider collected on a refused parcel becomes its return charge.

let admin: string;
let seq = Math.floor(Date.now() / 1000) * 1000 + 500;
const consignments: string[] = [];
beforeAll(async () => {
  admin = await ownerId();
});
beforeEach(() => {
  courier.status = "partial_delivered";
});
afterAll(async () => {
  await prisma.courierWebhookEvent.deleteMany({ where: { consignmentId: { in: consignments } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

/** A shipped, Steadfast-booked COD order with free delivery (1000 per unit). */
async function shipped(qty = 1) {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1000 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: qty }]);
  const consignmentId = String(++seq);
  consignments.push(consignmentId);
  await prisma.order.update({ where: { id: order.id }, data: { shippingFee: 0, total: 1000 * qty, courierConsignmentId: consignmentId } });
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] as const) await updateOrderStatus(order.id, { status: s }, admin);
  return { order, consignmentId };
}

const partial = (consignmentId: string, cod: unknown) => ({
  notification_type: "delivery_status", consignment_id: Number(consignmentId), invoice: "x", status: "Partial_Delivered", cod_amount: cod, delivery_charge: 120,
  tracking_message: "Customer refused, paid the delivery charge", updated_at: "2026-10-21 12:00:00",
});
const itemsOf = async (orderId: string) => (await prisma.orderItem.findMany({ where: { orderId }, select: { id: true, quantity: true } }));
const collectedOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { courierCollectedAmount: true } })).courierCollectedAmount?.toNumber() ?? null;

describe("Steadfast webhook body", () => {
  it("is read defensively: numeric strings, lower-cased status, default type, junk → null", () => {
    expect(parseSteadfastWebhook({ consignment_id: "123", status: "Partial_Delivered", cod_amount: "100.50" })).toMatchObject({
      notificationType: "delivery_status", consignmentId: "123", status: "partial_delivered", codAmount: 100.5,
    });
    expect(parseSteadfastWebhook({ consignment_id: 7, status: "Partial Delivered" })).toMatchObject({ consignmentId: "7", status: "partial_delivered" });
    expect(parseSteadfastWebhook({ consignment_id: "1; drop", cod_amount: "abc", delivery_charge: -5 })).toMatchObject({ consignmentId: null, codAmount: null, deliveryCharge: null });
    expect(parseSteadfastWebhook(null)).toMatchObject({ consignmentId: null, notificationType: "delivery_status" });
  });
});

describe("refused parcel — the rider collected the delivery charge", () => {
  it("collected 100 → kept on the order; once every unit is reconciled back it is the return charge, nothing owed back", async () => {
    const { order, consignmentId } = await shipped();
    expect(await handleSteadfastWebhook(partial(consignmentId, 100), { idempotencyKey: `k-${consignmentId}` })).toBe("APPLIED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PARTIALLY_DELIVERED");
    expect(await collectedOf(order.id)).toBe(100);
    // Not settled yet: until staff reconcile, Steadfast's figure might be paying for items the customer kept.
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(0);

    const items = await itemsOf(order.id);
    await reconcilePartialDelivery(order.id, { items: items.map((i) => ({ orderItemId: i.id, returnedQuantity: i.quantity })) }, admin);
    const summary = await getOrderPaymentSummary(order.id);
    expect(summary).toMatchObject({ returnCharge: 100, paid: 0, refundDue: 0 });
    expect(summary.payments[0]).toMatchObject({ provider: "COD", purpose: "RETURN_CHARGE", amount: 100 });

    // Returned later, the same webhook again (Steadfast retry) and a fresh one: still exactly one return charge.
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);
    expect(await handleSteadfastWebhook(partial(consignmentId, 100), { idempotencyKey: `k-${consignmentId}` })).toBe("DUPLICATE");
    await handleSteadfastWebhook(partial(consignmentId, 100));
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ returnCharge: 100, refundDue: 0 });

    const log = await prisma.courierWebhookEvent.findMany({ where: { consignmentId }, orderBy: { receivedAt: "asc" } });
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ orderId: order.id, status: "partial_delivered", outcome: "APPLIED", notificationType: "delivery_status" });
    expect([log[0]!.codAmount?.toNumber(), log[0]!.deliveryCharge?.toNumber(), log[0]!.trackingMessage]).toEqual([100, 120, "Customer refused, paid the delivery charge"]);
  });

  it("moving the order to Returned settles it too (no reconciliation step)", async () => {
    const { order, consignmentId } = await shipped();
    await handleSteadfastWebhook(partial(consignmentId, 80));
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ returnCharge: 80, refundDue: 0 });
  });

  it("the customer kept an item → the collection pays for it: never auto-settled", async () => {
    const { order, consignmentId } = await shipped(2);
    await handleSteadfastWebhook(partial(consignmentId, 1000));
    const [item] = await itemsOf(order.id);
    await reconcilePartialDelivery(order.id, { items: [{ orderItemId: item!.id, returnedQuantity: 1 }] }, admin);
    expect(await collectedOf(order.id)).toBe(1000);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("cash staff already recorded by hand is never counted twice", async () => {
    const { order, consignmentId } = await shipped();
    await handleSteadfastWebhook(partial(consignmentId, 100));
    await recordManualPayment(order.id, { amount: 100, kind: "COD_COLLECTED" }, admin);
    await updateOrderStatus(order.id, { status: "RETURNED" }, admin);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await getOrderPaymentSummary(order.id)).toMatchObject({ returnCharge: 0, refundDue: 100 });
  });

  it("the body's amount is trusted only when Steadfast's own API also says partial_delivered", async () => {
    const { order, consignmentId } = await shipped();
    courier.status = "cancelled";
    await handleSteadfastWebhook(partial(consignmentId, 100));
    expect(await collectedOf(order.id)).toBeNull();
    // A cancelled push's cod_amount is the booked COD, not money collected — ignored.
    await handleSteadfastWebhook({ ...partial(consignmentId, 1000), status: "cancelled" });
    expect(await collectedOf(order.id)).toBeNull();
  });

  it("unknown consignments and bodies without one are logged and ignored", async () => {
    const unknown = String(++seq);
    consignments.push(unknown);
    expect(await handleSteadfastWebhook(partial(unknown, 100))).toBe("NO_ORDER");
    expect(await prisma.courierWebhookEvent.count({ where: { consignmentId: unknown, outcome: "NO_ORDER" } })).toBe(1);
    expect(await handleSteadfastWebhook({ notification_type: "tracking_update" })).toBe("NO_CONSIGNMENT");
  });
});

describe("HTTP — POST /api/courier/steadfast/webhook", () => {
  it("accepts the token in the query string or as the panel's Bearer auth token; anything else is 401", async () => {
    const restore = overrideIntegrationsForTests({ STEADFAST_WEBHOOK_TOKEN: "wh-secret-123" });
    try {
      const { consignmentId } = await shipped();
      const body = partial(consignmentId, 50);
      expect((await request(app).post("/api/courier/steadfast/webhook?token=wh-secret-123").send(body)).status).toBe(200);
      expect((await request(app).post("/api/courier/steadfast/webhook").set("Authorization", "Bearer wh-secret-123").set("Idempotency-Key", `h-${consignmentId}`).send(body)).status).toBe(200);
      expect((await request(app).post("/api/courier/steadfast/webhook").set("Authorization", "Bearer nope").send(body)).status).toBe(401);
      expect((await request(app).post("/api/courier/steadfast/webhook?token=nope").send(body)).status).toBe(401);
      expect(await prisma.courierWebhookEvent.count({ where: { consignmentId, idempotencyKey: `h-${consignmentId}` } })).toBe(1);
      // A busy day: Steadfast's authenticated pushes are never rate-limited (only refused calls count).
      for (let i = 0; i < 35; i++) {
        expect((await request(app).post("/api/courier/steadfast/webhook").set("Authorization", "Bearer wh-secret-123").send({ notification_type: "tracking_update" })).status).toBe(200);
      }
    } finally {
      restore();
    }
  });
});
