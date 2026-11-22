import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Steadfast's API is replaced: each test says what its own record of the parcel is; a booking returns a consignment.
const courier = vi.hoisted(() => ({ status: "pending", next: 0 }));
vi.mock("../../providers/courier/steadfast", async (original) => ({
  ...(await original<typeof import("../../providers/courier/steadfast")>()),
  createSteadfastConsignment: vi.fn(async () => ({ consignment_id: ++courier.next, tracking_code: `SFR${courier.next}`, status: "in_review" })),
  createBulkSteadfastConsignments: vi.fn(async (items: Array<{ invoice: string }>) =>
    items.map((i) => ({ invoice: i.invoice, consignment_id: ++courier.next, tracking_code: `SFR${courier.next}`, status: "success" })),
  ),
  getSteadfastBalance: vi.fn(async () => 0),
  getSteadfastFraudCheck: vi.fn(async () => {
    throw new Error("no courier in tests");
  }),
  getSteadfastStatusByConsignmentId: vi.fn(async () => courier.status),
  getSteadfastStatusByInvoice: vi.fn(async () => null),
}));
import { prisma } from "../../config/prisma";
import { getSteadfastStatusByConsignmentId } from "../../providers/courier/steadfast";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";
import { bookOrderWithSteadfast, bookOrdersWithSteadfastBulk, handleSteadfastWebhook, unlinkCourierBooking } from "./courier.service";

// docs/PAYMENT_LEDGER.md §5c — the cash-on-delivery amount as Steadfast last said it is: a fact on the order, never money.

let admin: string;
let seq = Math.floor(Date.now() / 1000) * 1000 + 700;
const orders: string[] = [];
beforeAll(async () => {
  admin = await ownerId();
  courier.next = seq * 10;
});
beforeEach(() => {
  courier.status = "pending";
});
afterAll(async () => {
  await prisma.courierWebhookEvent.deleteMany({ where: { orderId: { in: orders } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

/** A shipped COD order of 1510, booked with Steadfast for 1510. */
async function shipped() {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: 1510 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  orders.push(order.id);
  const consignmentId = String(++seq);
  await prisma.order.update({ where: { id: order.id }, data: { shippingFee: 0, total: 1510, courierConsignmentId: consignmentId, courierCodBooked: 1510 } });
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] as const) await updateOrderStatus(order.id, { status: s }, admin);
  return { order, consignmentId };
}

const panelEdit = (cid: string, to: number, at: string) => ({
  notification_type: "consignment_update", consignment_id: Number(cid), invoice: "x", changed: ["cod_amount"], values: { cod_amount: to }, updated_at: at,
});
const hubEdit = (cid: string, from: number, to: number, at: string) => ({
  notification_type: "tracking_update", consignment_id: Number(cid), invoice: "x", tracking_message: `Amount has been changed  from "${from}" to "${to}"`, updated_at: at,
});
const fact = async (id: string) => {
  const o = await prisma.order.findUniqueOrThrow({
    where: { id },
    select: { courierCodNow: true, courierCodSource: true, courierCodBooked: true, total: true, paymentStatus: true, status: true },
  });
  return { now: o.courierCodNow?.toNumber() ?? null, source: o.courierCodSource, booked: o.courierCodBooked?.toNumber() ?? null, total: o.total.toNumber(), pay: o.paymentStatus, status: o.status };
};
const codLines = (id: string) => prisma.orderStatusHistory.count({ where: { orderId: id, note: { contains: "cash on delivery" } } });

describe("a COD change is kept as a fact", () => {
  it("records the amount and who changed it, with one timeline line; total, payments and status stay", async () => {
    const { order, consignmentId } = await shipped();
    await handleSteadfastWebhook(panelEdit(consignmentId, 120, "2026-11-22 12:48:40"));
    expect(await fact(order.id)).toEqual({ now: 120, source: "MERCHANT", booked: 1510, total: 1510, pay: "UNPAID", status: "SHIPPED" });
    expect(await codLines(order.id)).toBe(1);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("the same change pushed again, or told a second way, adds no line", async () => {
    const { order, consignmentId } = await shipped();
    await handleSteadfastWebhook(panelEdit(consignmentId, 120, "2026-11-22 12:48:40"));
    await handleSteadfastWebhook(panelEdit(consignmentId, 120, "2026-11-22 12:48:40"));
    await handleSteadfastWebhook(hubEdit(consignmentId, 1510, 120, "2026-11-22 12:48:41"));
    expect((await fact(order.id)).now).toBe(120);
    expect(await codLines(order.id)).toBe(1);
  });

  it("an older change arriving late never overwrites a newer one", async () => {
    const { order, consignmentId } = await shipped();
    await handleSteadfastWebhook(hubEdit(consignmentId, 120, 1500, "2026-11-22 15:00:00"));
    await handleSteadfastWebhook(panelEdit(consignmentId, 120, "2026-11-22 12:48:40"));
    expect(await fact(order.id)).toMatchObject({ now: 1500, source: "COURIER" });
  });

  it("cut to the fee and back to full: the last figure stands, both lines kept", async () => {
    const { order, consignmentId } = await shipped();
    await handleSteadfastWebhook(panelEdit(consignmentId, 120, "2026-11-22 12:00:00"));
    await handleSteadfastWebhook(panelEdit(consignmentId, 1510, "2026-11-22 13:00:00"));
    expect((await fact(order.id)).now).toBe(1510);
    expect(await codLines(order.id)).toBe(2);
  });

  it("a raise is recorded and is not money", async () => {
    const { order, consignmentId } = await shipped();
    await handleSteadfastWebhook(panelEdit(consignmentId, 1600, "2026-11-22 12:00:00"));
    expect(await fact(order.id)).toMatchObject({ now: 1600, total: 1510, pay: "UNPAID" });
  });

  it("three copies arriving together leave one line", async () => {
    const { order, consignmentId } = await shipped();
    await Promise.all([1, 2, 3].map(() => handleSteadfastWebhook(panelEdit(consignmentId, 120, "2026-11-22 12:48:40"))));
    expect(await codLines(order.id)).toBe(1);
  });

  it("a change is kept even when Steadfast's status API can't be asked", async () => {
    const { order, consignmentId } = await shipped();
    vi.mocked(getSteadfastStatusByConsignmentId).mockRejectedValueOnce(new Error("down"));
    await handleSteadfastWebhook(panelEdit(consignmentId, 120, "2026-11-22 12:48:40")).catch(() => undefined);
    expect((await fact(order.id)).now).toBe(120);
  });

  it("a push without a time, after a timed one, is taken as now", async () => {
    const { order, consignmentId } = await shipped();
    await handleSteadfastWebhook(panelEdit(consignmentId, 120, "2026-11-20 12:00:00"));
    await handleSteadfastWebhook({ ...panelEdit(consignmentId, 200, ""), updated_at: undefined });
    expect((await fact(order.id)).now).toBe(200);
  });
});

describe("what the parcel was booked with", () => {
  async function confirmed() {
    const { variants } = await createStockedProduct({ stocks: [10], basePrice: 900 });
    const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
    orders.push(order.id);
    await updateOrderStatus(order.id, { status: "CONFIRMED" }, admin);
    return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  it("single and bulk booking keep the COD sent; unlinking clears the facts", async () => {
    const a = await confirmed();
    await bookOrderWithSteadfast(a.id);
    expect((await fact(a.id)).booked).toBe(a.total.toNumber());
    const b = await confirmed();
    await bookOrdersWithSteadfastBulk([b.id]);
    expect((await fact(b.id)).booked).toBe(b.total.toNumber());

    const cid = (await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).courierConsignmentId!;
    await handleSteadfastWebhook(panelEdit(cid, 100, "2026-11-22 12:00:00"));
    expect((await fact(a.id)).now).toBe(100);
    await unlinkCourierBooking(a.id);
    expect(await fact(a.id)).toMatchObject({ now: null, booked: null, source: null });
  });
});
