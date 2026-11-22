import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const courier = vi.hoisted(() => ({ status: "delivered" }));
vi.mock("../../providers/courier/steadfast", async (original) => ({
  ...(await original<typeof import("../../providers/courier/steadfast")>()),
  createSteadfastConsignment: vi.fn(),
  createBulkSteadfastConsignments: vi.fn(),
  getSteadfastBalance: vi.fn(async () => 0),
  getSteadfastFraudCheck: vi.fn(async () => {
    throw new Error("no courier in tests");
  }),
  getSteadfastStatusByConsignmentId: vi.fn(async () => courier.status),
}));
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";
import { updateShipmentCosts } from "../../domain/shipments/shipment.service";
import { syncOrderShipments } from "../../domain/shipments/shipment-sync";
import { fillMissingCourierCharges } from "../../domain/shipments/courier-charge";
import { handleSteadfastWebhook } from "./courier.service";

// docs/COURIER_COSTS.md §2 — the delivery charge Steadfast pushes is kept on the parcel's leg, provisional until a payout proves it.

let admin: string;
let seq = Math.floor(Date.now() / 1000) * 1000 + 900;
const orders: string[] = [];
beforeAll(async () => {
  admin = await ownerId();
});
beforeEach(() => {
  courier.status = "delivered";
});
afterAll(async () => {
  await prisma.courierWebhookEvent.deleteMany({ where: { orderId: { in: orders } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function shipped() {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1510 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  orders.push(order.id);
  const consignmentId = String(++seq);
  await prisma.order.update({
    where: { id: order.id },
    data: { shippingFee: 0, total: 1510, courierConsignmentId: consignmentId, courierBookedAt: new Date(), courierCodBooked: 1510 },
  });
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] as const) await updateOrderStatus(order.id, { status: s }, admin);
  await syncOrderShipments(order.id);
  return { order, consignmentId };
}
const push = (cid: string, status: string, cod: number, charge: unknown) => ({
  notification_type: "delivery_status", consignment_id: Number(cid), invoice: "x", status, cod_amount: cod, delivery_charge: charge, updated_at: "2026-11-22 12:00:00",
});
const leg = (cid: string) => prisma.shipment.findFirstOrThrow({ where: { consignmentId: cid } });
const charge = async (cid: string) => {
  const l = await leg(cid);
  return { amount: l.actualCharge?.toNumber() ?? null, status: l.chargeStatus, source: l.chargeSource };
};

describe("Steadfast's delivery charge", () => {
  it("is kept on the parcel's leg as a provisional charge, with an event", async () => {
    const { consignmentId } = await shipped();
    await handleSteadfastWebhook(push(consignmentId, "delivered", 1510, "115.00"));
    expect(await charge(consignmentId)).toEqual({ amount: 115, status: "ENTERED", source: "COURIER_WEBHOOK" });
    const l = await leg(consignmentId);
    expect(await prisma.shipmentCostEvent.count({ where: { shipmentId: l.id, source: "COURIER_WEBHOOK" } })).toBe(1);
  });

  it("the same charge again adds nothing; a different one replaces it", async () => {
    const { consignmentId } = await shipped();
    await handleSteadfastWebhook(push(consignmentId, "delivered", 1510, 115));
    await handleSteadfastWebhook(push(consignmentId, "delivered", 1510, 115));
    const l = await leg(consignmentId);
    expect(await prisma.shipmentCostEvent.count({ where: { shipmentId: l.id, source: "COURIER_WEBHOOK" } })).toBe(1);
    await handleSteadfastWebhook(push(consignmentId, "delivered", 1510, 135));
    expect((await charge(consignmentId)).amount).toBe(135);
  });

  it("a cancelled parcel's charge is kept too; a missing or zero charge changes nothing", async () => {
    courier.status = "cancelled";
    const a = await shipped();
    await handleSteadfastWebhook(push(a.consignmentId, "cancelled", 1510, 115));
    expect((await charge(a.consignmentId)).amount).toBe(115);
    courier.status = "delivered";
    const b = await shipped();
    await handleSteadfastWebhook(push(b.consignmentId, "delivered", 1510, 0));
    await handleSteadfastWebhook(push(b.consignmentId, "delivered", 1510, null));
    expect(await charge(b.consignmentId)).toEqual({ amount: null, status: "MISSING", source: null });
  });

  it("what a person entered is never overwritten", async () => {
    const { consignmentId } = await shipped();
    const l = await leg(consignmentId);
    await updateShipmentCosts(l.id, { version: l.version, actualCharge: 99, chargeStatus: "ENTERED", chargeSource: "PANEL" } as never, {
      adminId: admin,
      permissions: ["courier_costs.record", "courier_costs.verify"],
    } as never);
    await handleSteadfastWebhook(push(consignmentId, "delivered", 1510, 115));
    expect((await charge(consignmentId)).amount).toBe(99);
  });

  it("charges already in the log fill legs that have none, once", async () => {
    const { order, consignmentId } = await shipped();
    await prisma.courierWebhookEvent.create({
      data: { notificationType: "delivery_status", consignmentId, orderId: order.id, status: "delivered", deliveryCharge: 105, payload: {}, outcome: "APPLIED" },
    });
    expect(await fillMissingCourierCharges()).toBeGreaterThanOrEqual(1);
    expect(await charge(consignmentId)).toEqual({ amount: 105, status: "ENTERED", source: "COURIER_WEBHOOK" });
    const l = await leg(consignmentId);
    await fillMissingCourierCharges();
    expect((await leg(consignmentId)).version).toBe(l.version);
  });
});

describe("what the rider collected on a partial delivery", () => {
  const collected = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).courierCollectedAmount?.toNumber() ?? null;
  const hubEdit = (cid: string, from: number, to: number) => ({
    notification_type: "tracking_update", consignment_id: Number(cid), invoice: "x", tracking_message: `Amount has been changed  from "${from}" to "${to}"`, updated_at: "2026-11-21 13:17:00",
  });

  it("is kept while Steadfast's approval is pending", async () => {
    courier.status = "partial_delivered_approval_pending";
    const { order, consignmentId } = await shipped();
    await handleSteadfastWebhook(push(consignmentId, "partial_delivered", 150, 115));
    expect(await collected(order.id)).toBe(150);
  });

  it("comes from the COD change when the push still carries the booked amount", async () => {
    courier.status = "pending";
    const { order, consignmentId } = await shipped();
    await handleSteadfastWebhook(hubEdit(consignmentId, 1510, 120));
    expect(await collected(order.id)).toBeNull();
    courier.status = "partial_delivered_approval_pending";
    await handleSteadfastWebhook(push(consignmentId, "partial_delivered", 1510, 135));
    expect(await collected(order.id)).toBe(120);
  });

  it("is taken when the COD change is told after the partial delivery", async () => {
    courier.status = "partial_delivered";
    const { order, consignmentId } = await shipped();
    await handleSteadfastWebhook(push(consignmentId, "partial_delivered", 1510, 135));
    expect(await collected(order.id)).toBeNull();
    await handleSteadfastWebhook(hubEdit(consignmentId, 1510, 120));
    expect(await collected(order.id)).toBe(120);
  });
});
