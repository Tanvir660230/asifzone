import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, RUN, trackOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../../modules/orders/order.service";
import { handleSteadfastWebhook } from "../../modules/courier/courier.service";
import { createReturnRequest } from "../../modules/return-requests/return-request.service";
import { clearCourierPayoutCache } from "./courier-evidence";
import { syncOrderShipments } from "./shipment-sync";

// Courier cost reconciliation (docs/COURIER_COSTS.md): shipment legs per order, actual charges vs contributions paid to
// the rider, returns and exchanges, payout corroboration, permissions, audit history and duplicate protection.

const courier = vi.hoisted(() => ({
  status: {} as Record<string, string>,
  payouts: [] as unknown[],
  detail: {} as Record<string, unknown>,
  returns: [] as unknown[],
}));
vi.mock("../../providers/courier/steadfast", async (orig) => ({
  ...(await orig<typeof import("../../providers/courier/steadfast")>()),
  getSteadfastStatusByConsignmentId: async (cid: string) => courier.status[cid] ?? "in_review",
  getSteadfastPayments: async () => ({ status: 200, message: "ok", payments: courier.payouts }),
  getSteadfastPayment: async (id: string) => courier.detail[id],
  getSteadfastReturnRequests: async () => ({ data: courier.returns }),
}));

const CSRF = "vitest-csrf";
const made: string[] = [];
let owner: string;
let staff: string;
let viewer: string;

function agent(adminId: string, role: "OWNER" | "STAFF" | "FINANCE_VIEWER") {
  const cookie = [`access_token=${signAccessToken({ adminId, role })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/shipments${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/shipments${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
    patch: (url: string, body: object) => auth(request(app).patch(`/api/shipments${url}`)).send(body),
    raw: auth,
  };
}
const asOwner = () => agent(owner, "OWNER");
const asStaff = () => agent(staff, "STAFF");

let seq = 0;
const cid = () => `SF-${RUN}-${++seq}`;

async function shippedOrder(consignment: string, opts: { variants?: number } = {}) {
  const p = await createStockedProduct({ stocks: Array.from({ length: opts.variants ?? 1 }, () => 20), basePrice: 1000 });
  const o = await placeOrder([{ variantId: p.variants[0]!.id, quantity: 1 }]);
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] as const) await updateOrderStatus(o.id, { status: s }, owner);
  await prisma.order.update({ where: { id: o.id }, data: { courierConsignmentId: consignment, carrier: "Steadfast", trackingNumber: `T${consignment}`, courierBookedAt: new Date(), courierStatus: "in_review" } });
  return { order: o, product: p };
}
async function courierSays(orderConsignment: string, status: string) {
  courier.status[orderConsignment] = status;
  await handleSteadfastWebhook({ consignment_id: orderConsignment });
}
async function legsOf(orderId: string) {
  const r = await asOwner().get(`/orders/${orderId}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as { shipments: Array<Record<string, any>>; exchanges: Array<Record<string, any>>; events: Array<Record<string, any>> };
}

beforeAll(async () => {
  owner = await ownerId();
  const mk = async (role: "STAFF" | "FINANCE_VIEWER", tag: string) => {
    const a = await prisma.adminUser.create({ data: { name: `CC ${tag}`, email: `cc-${tag}-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role } });
    made.push(a.id);
    return a.id;
  };
  staff = await mk("STAFF", "staff");
  viewer = await mk("FINANCE_VIEWER", "viewer");
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.auditLog.deleteMany({ where: { adminId: { in: made } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: made } } });
});

describe("a refused parcel: actual charge vs what the customer paid the rider", () => {
  let orderId: string;
  let leg: Record<string, any>;

  it("booking makes an OUTBOUND leg; the courier's 'cancelled' after shipping makes it RETURNED — charge unknown, nothing assumed", async () => {
    const c = cid();
    const { order } = await shippedOrder(c);
    orderId = order.id;
    await syncOrderShipments(orderId);
    expect((await legsOf(orderId)).shipments[0]).toMatchObject({ type: "OUTBOUND", operationalStatus: "IN_TRANSIT", financialStatus: "NOT_DUE", trackedByCourier: true });
    await courierSays(c, "cancelled");
    leg = (await legsOf(orderId)).shipments[0]!;
    expect(leg).toMatchObject({ operationalStatus: "RETURNED", chargeStatus: "MISSING", actualCharge: null, financialStatus: "AWAITING_ACTUAL_CHARGE" });
    expect(leg.figures.contributionApplies).toBe(true);
    expect(leg.standardCharge).toBeGreaterThan(0);
  });

  it("STAFF records what was reported (charge entered, contribution reported) but can't verify", async () => {
    const s = await asStaff().patch(`/${leg.id}/costs`, { version: leg.version, actualCharge: 120, chargeSource: "COURIER_PANEL", contributionReported: 100, contributionSource: "RIDER", note: "Rider said the customer paid 100" });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    leg = s.body.shipment;
    expect(leg).toMatchObject({ chargeStatus: "ENTERED", contributionStatus: "REPORTED", financialStatus: "AWAITING_ACTUAL_CHARGE" });
    expect(leg.figures.confirmedCharge).toBeNull();
    expect(leg.figures.provisional).toBe(true);
    const denied = await asStaff().patch(`/${leg.id}/costs`, { version: leg.version, chargeStatus: "VERIFIED", actualCharge: 120 });
    expect(denied.status).toBe(403);
    expect(denied.body.details?.code).toBe("VERIFY_PERMISSION");
  });

  it("the owner verifies: 120 charged, 100 paid → 20 uncovered, partially covered", async () => {
    const r = await asOwner().patch(`/${leg.id}/costs`, { version: leg.version, actualCharge: 120, chargeStatus: "VERIFIED", contributionStatus: "VERIFIED", contributionVerified: 100 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    leg = r.body.shipment;
    expect(leg).toMatchObject({ financialStatus: "PARTIALLY_COVERED", chargeStatus: "VERIFIED", contributionVerified: 100 });
    expect(leg.figures).toMatchObject({ confirmedCharge: 120, uncovered: 20, excess: 0, provisional: false });
    expect(leg.chargeVerifiedBy.id).toBe(owner);
  });

  it("a stale save is refused; replaying the same save is harmless", async () => {
    const stale = await asOwner().patch(`/${leg.id}/costs`, { version: leg.version - 1, actualCharge: 130, chargeStatus: "VERIFIED", reason: "typo" });
    expect(stale.status).toBe(409);
    expect(stale.body.details?.code).toBe("SHIPMENT_STALE");
    const before = await prisma.shipmentCostEvent.count({ where: { shipmentId: leg.id } });
    const replay = await asOwner().patch(`/${leg.id}/costs`, { version: leg.version - 1, actualCharge: 120, chargeStatus: "VERIFIED", contributionStatus: "VERIFIED", contributionVerified: 100 });
    expect(replay.status).toBe(200);
    expect(await prisma.shipmentCostEvent.count({ where: { shipmentId: leg.id } })).toBe(before);
  });

  it("can't be reconciled until someone decides who bears the 20; then reconciled", async () => {
    const blocked = await asOwner().post(`/${leg.id}/reconcile`, { version: leg.version });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/uncovered/i);
    expect((await asStaff().post(`/${leg.id}/reconcile`, { version: leg.version })).status).toBe(403);
    leg = (await asOwner().patch(`/${leg.id}/costs`, { version: leg.version, uncoveredTreatment: "ABSORBED" })).body.shipment;
    const ok = await asOwner().post(`/${leg.id}/reconcile`, { version: leg.version, note: "Checked against Steadfast panel" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    leg = ok.body.shipment;
    expect(leg.financialStatus).toBe("RECONCILED");
  });

  it("changing a verified figure on a reconciled record needs a reason, reopens it and keeps the history", async () => {
    const noReason = await asOwner().patch(`/${leg.id}/costs`, { version: leg.version, actualCharge: 115, chargeStatus: "VERIFIED" });
    expect(noReason.status).toBe(400);
    expect(noReason.body.details?.code).toBe("REASON_REQUIRED");
    const r = await asOwner().patch(`/${leg.id}/costs`, { version: leg.version, actualCharge: 115, chargeStatus: "VERIFIED", reason: "Steadfast invoice says 115" });
    expect(r.status).toBe(200);
    leg = r.body.shipment;
    expect(leg).toMatchObject({ reconciledAt: null, financialStatus: "PARTIALLY_COVERED" });
    expect(leg.figures.uncovered).toBe(15);
    const ev = await prisma.shipmentCostEvent.findFirstOrThrow({ where: { shipmentId: leg.id, action: "REOPENED" } });
    expect(ev).toMatchObject({ reason: "Steadfast invoice says 115", adminId: owner });
    expect((ev.changes as Record<string, { from: unknown; to: unknown }>).actualCharge).toEqual({ from: 120, to: 115 });
    await expect(prisma.shipmentCostEvent.update({ where: { id: ev.id }, data: { note: "tamper" } })).rejects.toThrow();
  });

  it("the contribution is never money received: the order's payments are untouched", async () => {
    expect(await prisma.payment.count({ where: { orderId } })).toBe(0);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.paymentStatus).toBe("UNPAID");
  });

  it("an overpayment waits for review; zero paid leaves the whole charge uncovered", async () => {
    let r = await asOwner().patch(`/${leg.id}/costs`, { version: leg.version, contributionStatus: "VERIFIED", contributionVerified: 150, reason: "Customer showed receipt for 150" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.shipment).toMatchObject({ financialStatus: "EXCESS_REVIEW" });
    expect(r.body.shipment.figures).toMatchObject({ uncovered: 0, excess: 35 });
    r = await asOwner().patch(`/${leg.id}/costs`, { version: r.body.shipment.version, contributionStatus: "VERIFIED", contributionVerified: 0, reason: "Receipt was for another parcel" });
    expect(r.body.shipment).toMatchObject({ financialStatus: "NOT_COVERED" });
    expect(r.body.shipment.figures.uncovered).toBe(115);
  });
});

describe("a normal delivery", () => {
  it("takes no contribution — the customer paid shipping in the order", async () => {
    const c = cid();
    const { order } = await shippedOrder(c);
    await courierSays(c, "delivered");
    const leg = (await legsOf(order.id)).shipments[0]!;
    expect(leg).toMatchObject({ operationalStatus: "DELIVERED", financialStatus: "AWAITING_ACTUAL_CHARGE" });
    const r = await asOwner().patch(`/${leg.id}/costs`, { version: leg.version, contributionReported: 50 });
    expect(r.status).toBe(400);
    expect(r.body.details?.code).toBe("CONTRIBUTION_NOT_APPLICABLE");
    const ok = await asOwner().patch(`/${leg.id}/costs`, { version: leg.version, actualCharge: 60, chargeStatus: "VERIFIED" });
    expect(ok.body.shipment.financialStatus).toBe("RECONCILED");
  });

  it("unlinking a booking keeps the old leg as untracked history", async () => {
    const c = cid();
    const { order } = await shippedOrder(c);
    await syncOrderShipments(order.id);
    await prisma.order.update({ where: { id: order.id }, data: { courierConsignmentId: null } });
    await syncOrderShipments(order.id);
    const leg = (await legsOf(order.id)).shipments.find((s) => s.consignmentId === c)!;
    expect(leg).toMatchObject({ trackedByCourier: false, operationalStatus: "CANCELLED" });
  });
});

describe("an exchange: return leg + replacement leg, counted separately and once", () => {
  let rootId: string;
  let back: Record<string, any>;
  let replacement: Record<string, any>;
  let requestId: string;

  it("approval opens the RETURN leg; booking the exchange order adds the REPLACEMENT leg", async () => {
    const c = cid();
    const { order, product } = await shippedOrder(c, { variants: 2 });
    rootId = order.id;
    await courierSays(c, "delivered");
    const totalBefore = Number((await prisma.order.findUniqueOrThrow({ where: { id: rootId } })).total);
    const rr = await createReturnRequest(order.customerId!, { orderId: rootId, type: "EXCHANGE", reason: "Size", orderItemId: order.items[0]!.id, requestedVariantId: product.variants[1]!.id } as never);
    requestId = rr.id;
    const approve = await asOwner().raw(request(app).patch(`/api/return-requests/${rr.id}`)).send({ status: "APPROVED" });
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const exchangeOrderId = approve.body.request.exchangeOrder.id as string;
    trackOrder(exchangeOrderId);
    const rc = cid();
    await prisma.order.update({ where: { id: exchangeOrderId }, data: { courierConsignmentId: rc, courierBookedAt: new Date(), courierStatus: "in_review", status: "PACKED" } });
    await courierSays(rc, "delivered");

    const data = await legsOf(exchangeOrderId); // opened from the exchange order: same legs as the original
    expect(data.shipments.map((s) => s.type).sort()).toEqual(["OUTBOUND", "REPLACEMENT", "RETURN"]);
    back = data.shipments.find((s) => s.type === "RETURN")!;
    replacement = data.shipments.find((s) => s.type === "REPLACEMENT")!;
    expect(back).toMatchObject({ operationalStatus: "RETURN_REQUESTED", returnRequest: { id: requestId } });
    expect(replacement.order.id).toBe(rootId);
    expect(replacement.parcelOrder.id).toBe(exchangeOrderId);
    expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: rootId } })).total)).toBe(totalBefore);
  });

  it("a second return leg for the same exchange is refused; a key replays", async () => {
    const r = await asOwner().post(`/orders/${rootId}`, { type: "RETURN", returnRequestId: requestId }, `cc-dup-${RUN}`);
    expect(r.status).toBe(409);
    expect(r.body.details?.code).toBe("SHIPMENT_EXISTS");
  });

  it("the brief's example: 120 return + 55 replacement, 100 paid → 175 expense, 75 uncovered", async () => {
    back = (await asOwner().patch(`/${back.id}/costs`, { version: back.version, operationalStatus: "RETURNED", actualCharge: 120, chargeStatus: "VERIFIED", contributionStatus: "VERIFIED", contributionReported: 100, contributionVerified: 100 })).body.shipment;
    expect(back.operationalStatus).toBe("RETURNED");
    const r = await asOwner().patch(`/${replacement.id}/costs`, { version: replacement.version, actualCharge: 55, chargeStatus: "VERIFIED", contributionStatus: "VERIFIED", contributionVerified: 0 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const ex = (await legsOf(rootId)).exchanges[0]!;
    expect(ex.summary).toMatchObject({ actualExpense: 175, verifiedContribution: 100, uncovered: 75, excess: 0, financialStatus: "PARTIALLY_COVERED", provisional: false });
    expect(ex.operationalStatus).toBe("EXCHANGE_COMPLETED");
  });

  it("the courier can't be told what to do with a tracked leg's status", async () => {
    const leg = (await legsOf(rootId)).shipments.find((s) => s.type === "REPLACEMENT")!;
    const r = await asOwner().patch(`/${leg.id}/costs`, { version: leg.version, operationalStatus: "RETURNED" });
    expect(r.body.details?.code).toBe("SHIPMENT_TRACKED");
  });

  it("the report finds the order's legs with the right totals, and filters by attention", async () => {
    const orderNumber = (await prisma.order.findUniqueOrThrow({ where: { id: rootId } })).orderNumber;
    const r = await agent(viewer, "FINANCE_VIEWER").get(`/report?search=${orderNumber}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.totals).toMatchObject({ exchanges: 175, verifiedContribution: 100, uncovered: 75 });
    expect(r.body.counts.uncoveredUndecided).toBe(2);
    const att = await asOwner().get(`/report?search=${orderNumber}&attention=missing_charge`);
    expect(att.body.items.map((i: { type: string }) => i.type)).toEqual(["OUTBOUND"]);
    expect((await agent(viewer, "FINANCE_VIEWER").patch(`/${back.id}/costs`, { version: back.version, note: "x" })).status).toBe(403);
  });
});

describe("courier payouts: charges proven by the payout's own total", () => {
  it("parcels whose standard charges add up to the payout's delivery charges are courier-confirmed; collected cash recorded", async () => {
    clearCourierPayoutCache();
    const [a, b] = [cid(), cid()];
    const o1 = await shippedOrder(a);
    const o2 = await shippedOrder(b);
    await courierSays(a, "delivered");
    await courierSays(b, "partial_delivered");
    const legs = [(await legsOf(o1.order.id)).shipments[0]!, (await legsOf(o2.order.id)).shipments[0]!];
    const due = legs.reduce((s, l) => s + l.estimatedCharge, 0);
    const payout = { payment_id: `SFC-${RUN}`, amount: 1100, due_bills: due, charges: 11, total: 1100 - due - 11, paid_at: "2026-10-20" };
    courier.payouts = [payout];
    courier.detail[payout.payment_id] = { status: 200, payment: { ...payout, consignments: [
      { consignment_id: a, invoice: o1.order.orderNumber, cod_amount: 1000, status: "delivered" },
      { consignment_id: b, invoice: o2.order.orderNumber, cod_amount: 1000, status: "partial_delivered" },
    ] } };
    const r = await asStaff().post("/payouts/sync");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.checks[0]).toMatchObject({ outcome: "CONFIRMED", confirmed: 2 });
    const l2 = (await legsOf(o2.order.id)).shipments[0]!;
    expect(l2).toMatchObject({ chargeStatus: "COURIER_CONFIRMED", chargeSource: "COURIER_PAYOUT", chargeReference: payout.payment_id, courierPayoutRef: payout.payment_id, courierCollected: 100 });
    expect(l2.financialStatus).toBe("AWAITING_CONTRIBUTION"); // a partial: what the customer paid the rider is still to be recorded

    // Recorded charges that no longer add up → both flagged for review, nothing overwritten.
    const l1 = (await legsOf(o1.order.id)).shipments[0]!;
    await asOwner().patch(`/${l1.id}/costs`, { version: l1.version, actualCharge: l1.actualCharge + 10, chargeStatus: "VERIFIED", reason: "Weight surcharge on invoice" });
    clearCourierPayoutCache();
    const again = await asOwner().post("/payouts/sync");
    expect(again.body.checks[0]).toMatchObject({ outcome: "MISMATCH", flagged: 2 });
    const flagged = (await legsOf(o1.order.id)).shipments[0]!;
    expect(flagged).toMatchObject({ financialStatus: "NEEDS_REVIEW", actualCharge: l1.actualCharge + 10 });
    const cleared = await asOwner().post(`/${flagged.id}/clear-review`, { version: flagged.version, note: "Steadfast confirmed the surcharge on a separate bill" });
    expect(cleared.body.shipment.reviewReason).toBeNull();
  });
});
