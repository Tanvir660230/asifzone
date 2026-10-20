import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, markOpeningPostedInTx, ownerId, placeOrder, purgeFinanceTables, RUN } from "../../test-fixtures";
import { updateOrderStatus } from "../../modules/orders/order.service";
import { settlePaymentSession } from "../../modules/payments/payment.service";
import { financeTransaction } from "./finance-tx";
import { getFinanceContext } from "./finance-context";
import { projectOrder, syncCommerce } from "./commerce-accounting.service";

// Owner's books §3–§4 (docs/FINANCE_OWNER_BOOKS.md): a delivered parcel's courier charge and an online payment's gateway
// fee are booked as ESTIMATES the day they happen (from the rate card), and replaced by the ACTUAL charge when the payout
// is posted — never counted twice. Steadfast's payouts come from its API as DRAFT settlements matched by consignment id.

const payouts = vi.hoisted(() => ({ list: [] as unknown[], detail: {} as Record<string, unknown>, balance: 0 }));
vi.mock("../../providers/courier/steadfast", async (orig) => ({
  ...(await orig<typeof import("../../providers/courier/steadfast")>()),
  getSteadfastPayments: async () => ({ status: 200, data: payouts.list }),
  getSteadfastPayment: async (id: string) => payouts.detail[id],
  getSteadfastBalance: async () => payouts.balance,
}));

const CSRF = "vitest-csrf";
let admin: string;
const owner = () => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/v1/finance${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
    put: (url: string, body: object = {}) => auth(request(app).put(`/api/v1/finance${url}`)).send(body),
  };
};
let seq = 0;
const key = (l: string) => `charges-${l}-${RUN}-${++seq}`;
let bank: string;
let cod: string;
let eps: string;

async function accountId(mappingKey: string) {
  const { business } = await getFinanceContext();
  return (await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key: mappingKey } } })).accountId;
}
/** Σ (debit − credit) of posted lines on a mapped account, optionally of one order only. */
async function net(mappingKey: string, orderId?: string) {
  const lines = await prisma.journalLine.findMany({ where: { accountId: await accountId(mappingKey), entry: { status: "POSTED" }, ...(orderId ? { partyId: orderId } : {}) } });
  return Math.round(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) * 100) / 100;
}
async function deliveredParcel(consignment: string, district = "Dhaka", area = "Mirpur") {
  const p = await createStockedProduct({ stocks: [20], basePrice: 1000 });
  const o = await placeOrder([{ variantId: p.variants[0]!.id, quantity: 1 }], { shippingDistrict: district, shippingArea: area });
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] as const) await updateOrderStatus(o.id, { status: s }, admin);
  await prisma.order.update({ where: { id: o.id }, data: { courierConsignmentId: consignment, courierBookedAt: new Date(Date.now() - 3 * 86_400_000), courierStatus: "delivered" } });
  await updateOrderStatus(o.id, { status: "DELIVERED" }, admin);
  return prisma.order.findUniqueOrThrow({ where: { id: o.id } });
}
const chargeEvents = (orderId: string) => prisma.financialEvent.findMany({ where: { eventKey: { startsWith: `order:${orderId}:courier_charge` } }, orderBy: { receivedAt: "asc" } });

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  const ctx = await getFinanceContext();
  await financeTransaction(async (tx) => {
    await tx.financeBusiness.update({ where: { id: ctx.business.id }, data: { openingDate: new Date("2026-01-01T00:00:00Z") } });
    await tx.financeAuditEntry.create({ data: { businessId: ctx.business.id, actorType: "SYSTEM", actorLabel: "test", action: "business.update", entityType: "FinanceBusiness", entityId: ctx.business.id } });
    await markOpeningPostedInTx(tx, ctx.business.id, new Date("2026-01-01T00:00:00Z"));
  });
  expect((await syncCommerce()).skipped).toBeUndefined();
  const fas = await prisma.financialAccount.findMany({ where: { businessId: ctx.business.id } });
  cod = fas.find((f) => f.kind === "COURIER")!.id;
  eps = fas.find((f) => f.name === "EPS clearing")!.id;
  const b = await owner().post("/financial-accounts", { kind: "BANK", name: `Payout bank ${RUN}` });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  bank = b.body.id;
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("rate cards", () => {
  it("a Steadfast card (zones by district / area, COD %, return %) and an EPS fee rate", async () => {
    const r = await owner().put("/rate-cards/courier", {
      effectiveFrom: "2026-01-01",
      zones: [{ name: "Inside Dhaka", districts: ["Dhaka"], areas: [], charge: 60 }, { name: "Sub-Dhaka", districts: [], areas: ["Savar", "Keraniganj"], charge: 100 }],
      defaultCharge: 120, codPercent: 1, returnChargePercent: 50,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await owner().put("/rate-cards/gateway", { provider: "EPS_PG", effectiveFrom: "2026-01-01", percent: 2.5, fixed: 0 })).status).toBe(200);
    expect((await owner().put("/rate-cards/courier", { effectiveFrom: "2026-01-01", zones: [{ name: "A", districts: [], areas: [], charge: 1 }], defaultCharge: 1, codPercent: 1, returnChargePercent: 1 })).body.details?.code).toBe("RATE_CARD_ZONES");
    const list = (await owner().get("/rate-cards")).body;
    expect(list.courierCards).toHaveLength(1);
    expect(list.gatewayRates[0]).toMatchObject({ provider: "EPS_PG", percent: 2.5 });
  });
});

describe("courier charges: estimate on delivery, actual at the payout", () => {
  let order: Awaited<ReturnType<typeof deliveredParcel>>;
  it("a delivered parcel books its estimated charge the same day: zone fee + 1% COD", async () => {
    order = await deliveredParcel(`CN-${RUN}-1`);
    await projectOrder(order.id);
    const total = Number(order.total);
    const estimate = 60 + Math.round(total) / 100;
    expect(await net("expense.courier_fees", order.id)).toBe(estimate);
    expect(await net("liability.courier_charges_accrued", order.id)).toBe(-estimate);
    const evs = await chargeEvents(order.id);
    expect(evs.map((e) => e.status)).toEqual(["POSTED"]);
    expect((evs[0]!.payload as { zone: string }).zone).toBe("Inside Dhaka");
  });

  it("re-running the sync records nothing new", async () => {
    await projectOrder(order.id);
    expect(await chargeEvents(order.id)).toHaveLength(1);
  });

  it("Steadfast's payout comes in as a draft matched by consignment; posting it books the actual charge and withdraws the estimate", async () => {
    const total = Number(order.total);
    payouts.list = [{ id: 9001, amount: total - 75, created_at: "2026-10-15 10:00:00" }];
    payouts.detail["9001"] = { status: 200, data: { id: 9001, amount: total - 75, consignments: [{ consignment_id: `CN-${RUN}-1`, invoice: order.orderNumber, cod_amount: total, delivery_charge: 65, cod_charge: 10 }] } };
    const imp = await owner().post("/courier/payouts/import", { destinationFinancialAccountId: bank });
    expect(imp.status, JSON.stringify(imp.body)).toBe(200);
    expect(imp.body.problems).toEqual([]);
    expect(imp.body.imported).toHaveLength(1);
    const s = imp.body.imported[0];
    expect(s).toMatchObject({ status: "DRAFT", source: "API_IMPORT", reference: "steadfast:9001", feeAmount: 75, netAmount: total - 75, unmatchedLines: 0 });
    expect(s.lines[0]).toMatchObject({ orderId: order.id, matchStatus: "MATCHED" });
    // a second import records nothing new
    expect((await owner().post("/courier/payouts/import", { destinationFinancialAccountId: bank })).body).toMatchObject({ alreadyRecorded: 1, imported: [] });
    expect((await owner().post(`/settlements/${s.id}/post`)).status).toBe(200);
    expect(await net("liability.courier_charges_accrued")).toBe(0);
    expect(await net("expense.courier_fees")).toBe(75); // the actual charge only — the estimate is withdrawn
    const evs = await chargeEvents(order.id);
    expect((evs[evs.length - 1]!.payload as { void: boolean }).void).toBe(true);
  });

  it("reversing the payout restores the estimate", async () => {
    const s = await prisma.clearingSettlement.findFirstOrThrow({ where: { reference: "steadfast:9001" } });
    expect((await owner().post(`/settlements/${s.id}/reverse`, { reason: "Wrong bank" })).status).toBe(200);
    expect(await net("liability.courier_charges_accrued", order.id)).toBeLessThan(0);
  });

  it("a returned parcel: the return charge (50% of the zone fee) — and a payout line that only deducts a charge", async () => {
    const p = await createStockedProduct({ stocks: [20], basePrice: 800 });
    const o = await placeOrder([{ variantId: p.variants[0]!.id, quantity: 1 }], { shippingDistrict: "Dhaka", shippingArea: "Savar" });
    for (const st of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] as const) await updateOrderStatus(o.id, { status: st }, admin);
    await prisma.order.update({ where: { id: o.id }, data: { courierConsignmentId: `CN-${RUN}-2`, courierBookedAt: new Date(Date.now() - 2 * 86_400_000), courierStatus: "cancelled", courierStatusSyncedAt: new Date() } });
    await projectOrder(o.id);
    expect(await net("expense.courier_fees", o.id)).toBe(50);
    const r = await owner().post("/settlements", {
      clearingFinancialAccountId: cod, destinationFinancialAccountId: bank, settlementDate: "2026-10-16", reference: `ret-${RUN}`,
      lines: [{ externalRef: `CN-${RUN}-2`, amount: 0, fee: 55 }, { externalRef: `CN-${RUN}-1`, amount: Number(order.total), fee: 75 }],
    }, key("ret"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.settlement.lines.map((l: { orderId: string }) => l.orderId)).toEqual([o.id, order.id]);
    expect((await owner().post(`/settlements/${r.body.settlement.id}/post`)).status).toBe(200);
    expect(await net("liability.courier_charges_accrued")).toBe(0);
  });
});

describe("gateway fees", () => {
  it("an EPS payment books its estimated fee; the EPS settlement replaces it", async () => {
    const p = await createStockedProduct({ stocks: [20], basePrice: 2000 });
    const o = await placeOrder([{ variantId: p.variants[0]!.id, quantity: 1 }]);
    await prisma.order.update({ where: { id: o.id }, data: { paymentMethod: "EPS_PG" } });
    const ps = await prisma.paymentSession.create({ data: { orderId: o.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: `ch_${o.id}`, expiresAt: new Date(Date.now() + 60_000), amount: o.total } });
    await settlePaymentSession(ps.gatewayTransactionRef, `eps_${o.id}`, Number(o.total));
    await projectOrder(o.id);
    const fee = Math.round(Number(o.total) * 2.5) / 100;
    expect(await net("expense.gateway_fees", o.id)).toBe(fee);
    const r = await owner().post("/settlements", {
      clearingFinancialAccountId: eps, destinationFinancialAccountId: bank, settlementDate: "2026-10-17", reference: `eps-${RUN}`,
      lines: [{ externalRef: `eps_${o.id}`, amount: Number(o.total), fee: fee + 1 }],
    }, key("eps"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await owner().post(`/settlements/${r.body.settlement.id}/post`)).status).toBe(200);
    expect(await net("liability.gateway_fees_accrued")).toBe(0);
    expect(await net("expense.gateway_fees")).toBe(fee + 1);
  });
});

describe("the courier's side of the books", () => {
  it("shows what the books expect from Steadfast next to its own balance, and the parcels that need a look", async () => {
    payouts.balance = 1234;
    const r = await owner().get("/courier/reconciliation");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.courier.balance).toBe(1234);
    expect(r.body.books).toHaveProperty("expectedFromCourier");
    expect(Array.isArray(r.body.stale)).toBe(true);
    expect(r.body.settings.payoutAccountId).toBe(bank);
  });

  it("profit per order carries its courier charge and gateway fee; the totals end at the books' net profit", async () => {
    const r = await owner().get("/profit?from=2026-01-01&to=2099-12-31");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.totals.courier).toBeGreaterThan(0);
    expect(r.body.totals.gateway).toBeGreaterThan(0);
    expect(Math.round((r.body.totals.contribution - r.body.totals.otherCosts) * 100) / 100).toBe(r.body.totals.netProfit);
    expect(r.body.orders.length).toBeGreaterThan(0);
    const launch = await owner().get("/profit/launch?from=2026-01-01&to=2099-12-31");
    expect(launch.status, JSON.stringify(launch.body)).toBe(200);
    expect(launch.body).toMatchObject({ estimate: true, courierRateCard: true });
  });

  it("the accrued charges are exactly the live estimates", async () => {
    const checks = await owner().post("/reconciliation/run", { checks: ["charges.accrued", "ledger.integrity"] });
    expect(checks.body.results.map((x: { status: string }) => x.status)).toEqual(["MATCHED", "MATCHED"]);
  });
});

describe("courier claims for lost parcels", () => {
  it("a claim is booked as owed by Steadfast; paid partly into the bank, partly inside a payout, the rest written off", async () => {
    const lost = await deliveredParcel(`CN-${RUN}-LOST`);
    const open = await owner().post("/courier/claims", { orderId: lost.id, amount: 1000, reason: "Parcel lost in transit" });
    expect(open.status, JSON.stringify(open.body)).toBe(201);
    expect(open.body).toMatchObject({ number: "CLM-000001", amount: 1000, outstanding: 1000, status: "OPEN" });
    expect(await net("asset.courier_claims")).toBe(1000);
    expect((await owner().post("/courier/claims", { orderId: lost.id, amount: 5, reason: "again" })).body.details?.code).toBe("CLAIM_EXISTS");
    const k = key("claim-money");
    const paid = await owner().post(`/courier/claims/${open.body.id}/settle`, { kind: "MONEY", amount: 600, financialAccountId: bank }, k);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect((await owner().post(`/courier/claims/${open.body.id}/settle`, { kind: "MONEY", amount: 600, financialAccountId: bank }, k)).body.outstanding).toBe(400); // same key: once
    expect((await owner().post(`/courier/claims/${open.body.id}/settle`, { kind: "PAYOUT", amount: 500 }, key("too-much"))).body.details?.code).toBe("CLAIM_TOO_MUCH");
    await owner().post(`/courier/claims/${open.body.id}/settle`, { kind: "PAYOUT", amount: 300 }, key("claim-payout"));
    const done = await owner().post(`/courier/claims/${open.body.id}/settle`, { kind: "WRITE_OFF", amount: 100, note: "Steadfast refused the rest" }, key("claim-wo"));
    expect(done.body).toMatchObject({ status: "SETTLED", outstanding: 0, received: 900 });
    expect(await net("asset.courier_claims")).toBe(0);
    expect((await owner().get("/courier/claims")).body.totals.outstanding).toBe(0);
    const checks = await owner().post("/reconciliation/run", { checks: ["ledger.integrity"] });
    expect(checks.body.results[0].status).toBe("MATCHED");
  });
});
