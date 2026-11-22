import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const courier = vi.hoisted(() => ({ status: "delivered" }));
vi.mock("../../providers/courier/steadfast", async (original) => ({
  ...(await original<typeof import("../../providers/courier/steadfast")>()),
  getSteadfastBalance: vi.fn(async () => 0),
  getSteadfastFraudCheck: vi.fn(async () => {
    throw new Error("no courier in tests");
  }),
  getSteadfastStatusByConsignmentId: vi.fn(async () => courier.status),
}));
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { handleSteadfastWebhook } from "../../modules/courier/courier.service";
import { updateOrderStatus } from "../../modules/orders/order.service";
import { getOrderPaymentSummary, recordManualPayment } from "./payment-ledger.service";
import { decideDoorShortfall, doorShortfalls } from "./door-collection.service";

// docs/PAYMENT_LEDGER.md §5d — a parcel delivered for less than the order says.

let admin: string;
let seq = Math.floor(Date.now() / 1000) * 1000 + 300;
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

async function shipped(total = 1510, prepaid = 0) {
  const { variants } = await createStockedProduct({ stocks: [10], basePrice: total });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  orders.push(order.id);
  if (prepaid) {
    await prisma.order.update({ where: { id: order.id }, data: { shippingFee: 0, total } });
    await recordManualPayment(order.id, { amount: prepaid, kind: "MANUAL" }, admin);
  }
  const cid = String(++seq);
  await prisma.order.update({
    where: { id: order.id },
    data: { shippingFee: 0, total, courierConsignmentId: cid, courierBookedAt: new Date(), courierCodBooked: total },
  });
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] as const) await updateOrderStatus(order.id, { status: s }, admin);
  return { id: order.id, cid };
}
/** A push while the parcel is still on its way (Steadfast's API says pending). */
const whileOnTheWay = async (body: unknown) => {
  courier.status = "pending";
  await handleSteadfastWebhook(body);
  courier.status = "delivered";
};
const edit = (cid: string, to: number, at = "2026-11-22 12:00:00") => ({
  notification_type: "consignment_update", consignment_id: Number(cid), invoice: "x", changed: ["cod_amount"], values: { cod_amount: to }, updated_at: at,
});
const delivered = (cid: string, cod: number, at = "2026-11-22 13:00:00") => ({
  notification_type: "delivery_status", consignment_id: Number(cid), invoice: "x", status: "delivered", cod_amount: cod, delivery_charge: 115, updated_at: at,
});
const row = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
const money = async (id: string) => {
  const [s, o] = await Promise.all([getOrderPaymentSummary(id), row(id)]);
  return { status: s.status, paid: s.paid, due: s.amountDue, cod: s.codToCollect, total: s.total, waiting: o.doorShortfallAt !== null };
};
const codRows = async (id: string) =>
  (await prisma.payment.findMany({ where: { orderId: id, provider: "COD" }, orderBy: { createdAt: "asc" } })).map((p) => `${p.status} ${p.amount.toNumber()}`);
const waitingIds = async () => (await doorShortfalls()).map((d) => d.orderId);

describe("what is booked when the parcel is delivered", () => {
  it("the COD was cut: only what was collected, and the order waits for a decision", async () => {
    const { id, cid } = await shipped();
    await handleSteadfastWebhook(edit(cid, 1200));
    await handleSteadfastWebhook(delivered(cid, 1200));
    expect(await money(id)).toEqual({ status: "PARTIALLY_PAID", paid: 1200, due: 310, cod: 0, total: 1510, waiting: true });
    expect(await codRows(id)).toEqual(["SUCCEEDED 1200"]);
    expect(await waitingIds()).toContain(id);
  });

  it("no change known: the whole balance, as always", async () => {
    const { id, cid } = await shipped();
    await handleSteadfastWebhook(delivered(cid, 1510));
    expect(await money(id)).toMatchObject({ status: "PAID", paid: 1510, waiting: false });
    expect(await waitingIds()).not.toContain(id);
  });

  it("cut and put back: the whole balance", async () => {
    const { id, cid } = await shipped();
    await whileOnTheWay(edit(cid, 120));
    await whileOnTheWay(edit(cid, 1510, "2026-11-22 12:30:00"));
    await handleSteadfastWebhook(delivered(cid, 1510));
    expect(await money(id)).toMatchObject({ status: "PAID", waiting: false });
  });

  it("delivered at the lower figure, then Steadfast puts it back: booked in full again, nothing waits", async () => {
    const { id, cid } = await shipped();
    await whileOnTheWay(edit(cid, 120));
    await handleSteadfastWebhook(delivered(cid, 120));
    expect(await money(id)).toMatchObject({ paid: 120, waiting: true });
    await handleSteadfastWebhook(edit(cid, 1510, "2026-11-22 14:00:00"));
    expect(await money(id)).toMatchObject({ status: "PAID", paid: 1510, waiting: false });
    expect(await codRows(id)).toEqual(["VOIDED 120", "SUCCEEDED 1510"]);
  });

  it("only the delivery push carries the lower amount", async () => {
    const { id, cid } = await shipped();
    await handleSteadfastWebhook(delivered(cid, 1450));
    expect(await money(id)).toMatchObject({ paid: 1450, due: 60, waiting: true });
  });

  it("nothing collected: no payment row, waits", async () => {
    const { id, cid } = await shipped();
    await handleSteadfastWebhook(edit(cid, 0));
    await handleSteadfastWebhook(delivered(cid, 0));
    expect(await money(id)).toMatchObject({ status: "UNPAID", paid: 0, due: 1510, waiting: true });
    expect(await codRows(id)).toEqual([]);
  });

  it("a raised COD is not taken as money and nothing waits", async () => {
    const { id, cid } = await shipped();
    await handleSteadfastWebhook(edit(cid, 1600));
    await handleSteadfastWebhook(delivered(cid, 1600));
    expect(await money(id)).toMatchObject({ status: "PAID", paid: 1510, waiting: false });
  });

  it("prepaid, COD 0: untouched", async () => {
    const { id, cid } = await shipped(1510, 1510);
    await handleSteadfastWebhook(delivered(cid, 0));
    expect(await money(id)).toMatchObject({ status: "PAID", paid: 1510, waiting: false });
  });

  it("part prepaid: the shortfall is against what the courier was to collect", async () => {
    const { id, cid } = await shipped(1510, 120);
    await handleSteadfastWebhook(edit(cid, 1390));
    await handleSteadfastWebhook(delivered(cid, 1390));
    expect(await money(id)).toMatchObject({ status: "PAID", waiting: false });
  });

  it("the status check booked the full amount first: the system's own row is replaced, once", async () => {
    const { id, cid } = await shipped();
    await updateOrderStatus(id, { status: "DELIVERED" }, admin);
    expect(await codRows(id)).toEqual(["SUCCEEDED 1510"]);
    await prisma.payment.updateMany({ where: { orderId: id, provider: "COD" }, data: { recordedByAdminId: null } });
    await handleSteadfastWebhook(delivered(cid, 1200));
    await handleSteadfastWebhook(delivered(cid, 1200));
    expect(await codRows(id)).toEqual(["VOIDED 1510", "SUCCEEDED 1200"]);
    expect(await money(id)).toMatchObject({ paid: 1200, waiting: true });
  });

  it("money a person recorded is never replaced", async () => {
    const { id, cid } = await shipped();
    await updateOrderStatus(id, { status: "DELIVERED" }, admin);
    await prisma.payment.updateMany({ where: { orderId: id, provider: "COD" }, data: { recordedByAdminId: admin } });
    await handleSteadfastWebhook(delivered(cid, 1200));
    expect(await codRows(id)).toEqual(["SUCCEEDED 1510"]);
    expect((await money(id)).waiting).toBe(false);
  });
});

describe("the decision", () => {
  async function short() {
    const o = await shipped();
    await handleSteadfastWebhook(edit(o.cid, 1200));
    await handleSteadfastWebhook(delivered(o.cid, 1200));
    return o;
  }

  it("agreed price: the sale is 1200, paid, with the reason on the timeline", async () => {
    const { id } = await short();
    await decideDoorShortfall(id, { decision: "AGREED_PRICE", note: "Customer bargained at the door" }, admin);
    expect(await money(id)).toEqual({ status: "PAID", paid: 1200, due: 0, cod: 0, total: 1200, waiting: false });
    const o = await row(id);
    expect([o.priceAdjustment.toNumber(), o.doorDecision, o.doorDecidedByAdminId]).toEqual([-310, "AGREED_PRICE", admin]);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: id, note: { contains: "Customer bargained at the door" }, changedByAdminId: admin } })).toBe(1);
    expect(await waitingIds()).not.toContain(id);
  });

  it("agreed price on top of an earlier discount adds to it", async () => {
    const o = await shipped();
    await prisma.order.update({ where: { id: o.id }, data: { priceAdjustment: -160, total: 1350 } });
    await handleSteadfastWebhook(edit(o.cid, 1300));
    await handleSteadfastWebhook(delivered(o.cid, 1300));
    await decideDoorShortfall(o.id, { decision: "AGREED_PRICE", note: "bargain" }, admin);
    const r = await row(o.id);
    expect([r.priceAdjustment.toNumber(), r.total.toNumber()]).toEqual([-210, 1300]);
  });

  it("still owed: the total stays and the balance is due", async () => {
    const { id } = await short();
    await decideDoorShortfall(id, { decision: "STILL_OWED", note: "Will send by bKash" }, admin);
    expect(await money(id)).toMatchObject({ status: "PARTIALLY_PAID", paid: 1200, due: 310, total: 1510, waiting: false });
  });

  it("collected in full after all: the rest is recorded by that person", async () => {
    const { id } = await short();
    await decideDoorShortfall(id, { decision: "COLLECTED_IN_FULL", note: "Panel shows 1510" }, admin);
    expect(await money(id)).toMatchObject({ status: "PAID", paid: 1510, waiting: false });
    expect(await prisma.payment.count({ where: { orderId: id, recordedByAdminId: admin, amount: 310 } })).toBe(1);
  });

  it("is made once, even when two people press at the same time", async () => {
    const { id } = await short();
    const r = await Promise.allSettled([
      decideDoorShortfall(id, { decision: "AGREED_PRICE", note: "bargain" }, admin),
      decideDoorShortfall(id, { decision: "AGREED_PRICE", note: "bargain" }, admin),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await row(id)).total.toNumber()).toBe(1200);
    await expect(decideDoorShortfall(id, { decision: "STILL_OWED", note: "again" }, admin)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("is refused on an order that isn't delivered, and without a reason", async () => {
    const o = await shipped();
    await expect(decideDoorShortfall(o.id, { decision: "AGREED_PRICE", collected: 1200, note: "bargain" }, admin)).rejects.toMatchObject({ statusCode: 409 });
    const s = await short();
    await expect(decideDoorShortfall(s.id, { decision: "AGREED_PRICE", note: " " }, admin)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("a webhook after the decision changes nothing", async () => {
    const { id, cid } = await short();
    await decideDoorShortfall(id, { decision: "AGREED_PRICE", note: "bargain" }, admin);
    await handleSteadfastWebhook(delivered(cid, 1200));
    await handleSteadfastWebhook(edit(cid, 1100, "2026-11-22 14:00:00"));
    expect(await money(id)).toMatchObject({ status: "PAID", paid: 1200, total: 1200, waiting: false });
  });
});

describe("parcels delivered before this existed", () => {
  it("are listed from the webhook log without being changed, and are put right by the decision", async () => {
    const { id, cid } = await shipped();
    await updateOrderStatus(id, { status: "DELIVERED" }, admin);
    await prisma.payment.updateMany({ where: { orderId: id, provider: "COD" }, data: { recordedByAdminId: null } });
    await prisma.courierWebhookEvent.create({
      data: { notificationType: "delivery_status", consignmentId: cid, orderId: id, status: "delivered", codAmount: 1200, payload: {}, outcome: "APPLIED" },
    });
    const listed = (await doorShortfalls()).find((d) => d.orderId === id);
    expect(listed).toMatchObject({ expected: 1510, collected: 1200, shortfall: 310, recorded: false });
    expect(await money(id)).toMatchObject({ status: "PAID", paid: 1510 });

    await decideDoorShortfall(id, { decision: "AGREED_PRICE", note: "bargain" }, admin);
    expect(await money(id)).toMatchObject({ status: "PAID", paid: 1200, total: 1200 });
    expect(await codRows(id)).toEqual(["VOIDED 1510", "SUCCEEDED 1200"]);
    expect(await waitingIds()).not.toContain(id);
  });

  it("with no figure from Steadfast, staff say what was collected", async () => {
    const { id } = await shipped();
    await updateOrderStatus(id, { status: "DELIVERED" }, admin);
    await prisma.payment.updateMany({ where: { orderId: id, provider: "COD" }, data: { recordedByAdminId: null } });
    await expect(decideDoorShortfall(id, { decision: "AGREED_PRICE", note: "bargain" }, admin)).rejects.toMatchObject({ statusCode: 409 });
    await decideDoorShortfall(id, { decision: "AGREED_PRICE", collected: 1500, note: "Steadfast page says 1500" }, admin);
    expect(await money(id)).toMatchObject({ status: "PAID", paid: 1500, total: 1500 });
  });

  it("a figure that isn't lower is refused", async () => {
    const { id } = await shipped();
    await updateOrderStatus(id, { status: "DELIVERED" }, admin);
    await expect(decideDoorShortfall(id, { decision: "AGREED_PRICE", collected: 1510, note: "bargain" }, admin)).rejects.toMatchObject({ statusCode: 409 });
  });
});
