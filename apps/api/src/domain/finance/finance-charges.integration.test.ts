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
import { approveCostEstimate, projectOrder, syncCommerce } from "./commerce-accounting.service";
import { setCostPolicy } from "./chart.service";
import { adjustVariantStock } from "../../modules/inventory/inventory.service";
import { PERMISSIONS } from "@clothing-brand/shared";
import type { FinanceActor } from "./finance-audit";

// Owner's books §3–§4 (docs/FINANCE_OWNER_BOOKS.md): a delivered parcel's courier charge and an online payment's gateway
// fee are booked as ESTIMATES the day they happen (from the rate card), and replaced by the ACTUAL charge when the payout
// is posted — never counted twice. Steadfast's payouts come from its API as DRAFT settlements matched by consignment id.

const payouts = vi.hoisted(() => ({ list: [] as unknown[], detail: {} as Record<string, unknown>, balance: 0 }));
vi.mock("../../providers/courier/steadfast", async (orig) => ({
  ...(await orig<typeof import("../../providers/courier/steadfast")>()),
  getSteadfastPayments: async () => ({ status: 200, alertClass: "success", message: "ok", payments: payouts.list }),
  getSteadfastPayment: async (id: string) => payouts.detail[id],
  getSteadfastBalance: async () => payouts.balance,
}));

// Autopilot asks whether live providers are on before calling Steadfast; the calls themselves are mocked above.
vi.mock("../../lib/provider-guard", async (orig) => ({ ...(await orig<typeof import("../../lib/provider-guard")>()), liveProvidersEnabled: () => true }));

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
    patch: (url: string, body: object = {}) => auth(request(app).patch(`/api/v1/finance${url}`)).send(body),
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
    // The live API's shape: amount (collected) − due_bills (delivery & return) − charges (COD) = total (paid).
    const payment = { payment_id: "SFC-9001", amount: total, due_bills: 65, charges: 10, total: total - 75, method: "Bkash", status_label: "paid", created_at: "2026-10-15 10:00:00", paid_at: "2026-10-15 16:00:00" };
    payouts.list = [payment];
    payouts.detail["SFC-9001"] = { status: 200, alertClass: "success", message: "ok", payment: { ...payment, consignments: [{ consignment_id: `CN-${RUN}-1`, invoice: order.orderNumber, cod_amount: total, status: "delivered" }] } };
    const imp = await owner().post("/courier/payouts/import", { destinationFinancialAccountId: bank });
    expect(imp.status, JSON.stringify(imp.body)).toBe(200);
    expect(imp.body.problems).toEqual([]);
    expect(imp.body.imported).toHaveLength(1);
    const s = imp.body.imported[0];
    expect(s).toMatchObject({ status: "DRAFT", source: "API_IMPORT", reference: "steadfast:SFC-9001", settlementDate: "2026-10-15", feeAmount: 75, netAmount: total - 75, unmatchedLines: 0 });
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
    const s = await prisma.clearingSettlement.findFirstOrThrow({ where: { reference: "steadfast:SFC-9001" } });
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

  it("a payout entered late withdraws the estimate on the payout's day — its month never counts the charge twice", async () => {
    const o = await deliveredParcel(`CN-${RUN}-late`);
    // Delivered in September (booked with the courier just before).
    await prisma.order.update({ where: { id: o.id }, data: { courierBookedAt: new Date("2026-09-08T06:00:00Z") } });
    await prisma.orderStatusHistory.updateMany({ where: { orderId: o.id, status: "DELIVERED" }, data: { createdAt: new Date("2026-09-10T06:00:00Z") } });
    await projectOrder(o.id);
    const r = await owner().post("/settlements", {
      clearingFinancialAccountId: cod, destinationFinancialAccountId: bank, settlementDate: "2026-10-01", reference: `late-${RUN}`,
      lines: [{ externalRef: `CN-${RUN}-late`, amount: Number(o.total), fee: 70 }],
    }, key("late"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await owner().post(`/settlements/${r.body.settlement.id}/post`)).status).toBe(200);
    const evs = await chargeEvents(o.id);
    const withdrawal = await prisma.journalEntry.findFirstOrThrow({ where: { financialEventId: evs[evs.length - 1]!.id } }).catch(async () =>
      prisma.journalEntry.findFirstOrThrow({ where: { reversesEntryId: (await prisma.journalEntry.findFirstOrThrow({ where: { financialEventId: evs[0]!.id } })).id } }),
    );
    expect(withdrawal.entryDate.toISOString().slice(0, 10)).toBe("2026-10-01");
    const october = await prisma.journalLine.findMany({ where: { partyId: o.id, accountId: await accountId("expense.courier_fees"), entry: { status: "POSTED", entryDate: { gte: new Date("2026-10-01T00:00:00Z"), lte: new Date("2026-10-31T00:00:00Z") } } } });
    const september = await prisma.journalLine.findMany({ where: { partyId: o.id, accountId: await accountId("expense.courier_fees"), entry: { status: "POSTED", entryDate: { lt: new Date("2026-10-01T00:00:00Z") } } } });
    const sum = (ls: typeof october) => Math.round(ls.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) * 100) / 100;
    expect(sum(september) + sum(october)).toBe(0); // the estimate in September, its withdrawal in October (the actual 70 is on the payout, no party)
    expect(sum(september)).toBeGreaterThan(0);
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

  it("a settlement that names one of an order's two payments withdraws only that payment's estimate", async () => {
    const p = await createStockedProduct({ stocks: [20], basePrice: 2000 });
    const o = await placeOrder([{ variantId: p.variants[0]!.id, quantity: 1 }]);
    await prisma.order.update({ where: { id: o.id }, data: { paymentMethod: "EPS_PG" } });
    const ps = await prisma.paymentSession.create({ data: { orderId: o.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: `ch2_${o.id}`, expiresAt: new Date(Date.now() + 60_000), amount: o.total } });
    await settlePaymentSession(ps.gatewayTransactionRef, `eps2a_${o.id}`, Number(o.total));
    // A second gateway payment on the same order (e.g. a later top-up of a price change).
    await prisma.payment.create({ data: { orderId: o.id, provider: "EPS_PG", status: "SUCCEEDED", amount: 100, providerTransactionId: `eps2b_${o.id}` } });
    await projectOrder(o.id);
    const before = await net("expense.gateway_fees", o.id);
    const r = await owner().post("/settlements", {
      clearingFinancialAccountId: eps, destinationFinancialAccountId: bank, settlementDate: "2026-10-18", reference: `eps2-${RUN}`,
      lines: [{ externalRef: `eps2a_${o.id}`, amount: Number(o.total), fee: 50 }],
    }, key("eps2"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await owner().post(`/settlements/${r.body.settlement.id}/post`)).status).toBe(200);
    // The 100 payment's estimate (2.5%) stays until its own settlement.
    expect(await net("liability.gateway_fees_accrued", o.id)).toBe(-2.5);
    expect(before).toBe(Math.round(Number(o.total) * 2.5) / 100 + 2.5);
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

describe("parcels booked straight on Steadfast (never orders on the site)", () => {
  it("a payout's unmatched parcel is counted as a sale outside the website — the clearing check stays clean", async () => {
    const order = await deliveredParcel(`CN-${RUN}-SITE`);
    const total = Number(order.total);
    const payment = { payment_id: "SFC-9002", amount: total + 500, due_bills: 120, charges: 15, total: total + 500 - 135, method: "Bkash", status_label: "paid", created_at: "2026-10-18 10:00:00", paid_at: "2026-10-18 16:00:00" };
    payouts.list = [payment];
    payouts.detail["SFC-9002"] = { status: 200, payment: { ...payment, consignments: [
      { consignment_id: `CN-${RUN}-SITE`, invoice: order.orderNumber, cod_amount: total, status: "delivered" },
      { consignment_id: `CN-${RUN}-DIRECT`, invoice: "", cod_amount: 500, status: "delivered" },
    ] } };
    const imp = await owner().post("/courier/payouts/import", { destinationFinancialAccountId: bank });
    const s = imp.body.imported[0];
    expect(s).toMatchObject({ unmatchedLines: 1, grossAmount: total + 500, netAmount: total + 365 });
    const marked = await owner().post(`/settlements/${s.id}/outside-sales`);
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    expect(marked.body).toMatchObject({ unmatchedLines: 0, outsideSaleLines: 1 });
    // The owner's cost percent for goods sold outside the website: 40% of the cash collected.
    const set = await owner().patch("/center/settings", { outsideSaleCostPct: 40 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect((await owner().get("/center/settings")).body).toMatchObject({ outsideSaleCostPct: 40 });
    const cogsBefore = await net("cogs.goods");
    expect((await owner().post(`/settlements/${s.id}/post`)).status).toBe(200);
    expect(await net("revenue.outside_sales")).toBe(-500);
    expect(await net("asset.inventory_sent_outside")).toBe(-200); // the goods that left, at their estimated cost
    expect(Math.round((await net("cogs.goods") - cogsBefore) * 100) / 100).toBe(200);
    const checks = await owner().post("/reconciliation/run", { checks: ["ledger.integrity", "charges.accrued"] });
    expect(checks.body.results.map((x: { status: string }) => x.status)).toEqual(["MATCHED", "MATCHED"]);
    const profit = (await owner().get("/profit?from=2026-01-01&to=2099-12-31")).body;
    expect(profit.totals).toMatchObject({ outsideSales: 500, outsideSalesCost: 200, outsideSaleCostPct: 40 });
    expect(Math.round((profit.totals.contribution + profit.totals.outsideSales - profit.totals.outsideSalesCost - profit.totals.otherCosts) * 100) / 100).toBe(profit.totals.netProfit);

    // Later the site's stock is corrected for the units that left: that decrease is the goods already costed — it comes off
    // 1690, not a second cost of goods.
    const p = await createStockedProduct({ stocks: [10], basePrice: 900 });
    await prisma.productVariant.update({ where: { id: p.variants[0]!.id }, data: { costPrice: 150 } });
    await adjustVariantStock(p.variants[0]!.id, -1, "ADJUSTMENT", admin, "counted: one went out by courier");
    await syncCommerce();
    const ex = await prisma.financeException.findFirstOrThrow({ where: { kind: "UNVALUED_STOCK_WRITE_OFF", sourceType: "StockMovement", details: { path: ["variantId"], equals: p.variants[0]!.id } } });
    const actor: FinanceActor = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
    await setCostPolicy({ costPolicy: "APPROVED_ESTIMATES", reason: "test" }, actor);
    const shrinkBefore = await net("cogs.inventory_shrinkage");
    await approveCostEstimate(ex.id, 150, "counted short — sent outside", actor);
    expect(await net("asset.inventory_sent_outside")).toBe(-50);
    expect(await net("cogs.inventory_shrinkage")).toBe(shrinkBefore);
  });
});

describe("autopilot (§15): payouts in, posted when every parcel is accounted for, kept by the owner", () => {
  it("is off until switched on; then a run brings payouts in, posts the clean ones and books them as the owner's drawings — once", async () => {
    const off = (await owner().post("/center/autopilot/run")).body;
    expect(off).toMatchObject({ payouts: { ok: true, skipped: "OFF" }, ownerDrawings: { ok: true, skipped: "OFF" }, profitShares: { ok: true, skipped: "OFF" } });
    const o = await owner().post("/equity/partners", { name: `Owner ${RUN}`, joinedOn: "2026-01-01", role: "OWNER" });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    const wallet = await owner().post("/financial-accounts", { kind: "MOBILE_WALLET", name: `Owner bKash ${RUN}` });
    expect((await owner().patch("/center/autopilot", { payoutAccountId: cod })).body.details?.code).toBe("PAYOUT_DESTINATION");
    const set = await owner().patch("/center/autopilot", { payoutAccountId: wallet.body.id, payoutsToOwner: true });
    expect(set.body).toMatchObject({ payoutAccount: { id: wallet.body.id }, payoutsToOwner: true, profitShares: false });

    const site = await deliveredParcel(`CN-${RUN}-AP1`);
    const mixed = await deliveredParcel(`CN-${RUN}-AP2`);
    const pay = (id: string, amount: number, day: string) => ({ payment_id: id, amount, due_bills: 0, charges: 0, total: amount, method: "Bkash", status_label: "paid", created_at: `${day} 10:00:00`, paid_at: `${day} 16:00:00` });
    const a = pay("SFC-9101", Number(site.total), "2026-10-19");
    const b = pay("SFC-9102", Number(mixed.total) + 300, "2026-10-20");
    const c = pay("SFC-9103", 450, "2026-10-20");
    payouts.list = [a, b, c];
    payouts.detail["SFC-9101"] = { status: 200, payment: { ...a, consignments: [{ consignment_id: `CN-${RUN}-AP1`, invoice: site.orderNumber, cod_amount: Number(site.total), status: "delivered" }] } };
    payouts.detail["SFC-9102"] = { status: 200, payment: { ...b, consignments: [
      { consignment_id: `CN-${RUN}-AP2`, invoice: mixed.orderNumber, cod_amount: Number(mixed.total), status: "delivered" },
      { consignment_id: `CN-${RUN}-AP2D`, invoice: "", cod_amount: 300, status: "delivered" },
    ] } };
    // Our invoice number on a parcel that matches no order: a person looks first.
    payouts.detail["SFC-9103"] = { status: 200, payment: { ...c, consignments: [{ consignment_id: `CN-${RUN}-AP3`, invoice: "ORD-NOT-HERE", cod_amount: 450, status: "delivered" }] } };

    const run = (await owner().post("/center/autopilot/run")).body;
    expect(run.payouts).toMatchObject({ ok: true, imported: 3, posted: ["steadfast:SFC-9101", "steadfast:SFC-9102"], waiting: [{ reference: "steadfast:SFC-9103", parcels: 1 }] });
    expect(run.ownerDrawings).toMatchObject({ ok: true, taken: 2, amount: Number(site.total) + Number(mixed.total) + 300 });
    expect(await net("revenue.outside_sales")).toBe(-800); // 500 from the earlier payout + 300 here
    const taken = (await owner().get("/equity/owner/payouts")).body.payouts.filter((p: { reference: string }) => ["steadfast:SFC-9101", "steadfast:SFC-9102"].includes(p.reference));
    expect(taken.map((p: { date: string; taken: string }) => [p.date, p.taken]).sort()).toEqual([["2026-10-19", "POSTED"], ["2026-10-20", "POSTED"]]);
    expect((await owner().get(`/financial-accounts/${wallet.body.id}`)).body.currentBalance).toBe(0);

    const again = (await owner().post("/center/autopilot/run")).body;
    expect(again.payouts).toMatchObject({ ok: true, imported: 0, posted: [], waiting: [{ reference: "steadfast:SFC-9103", parcels: 1 }] });
    expect(again.ownerDrawings).toMatchObject({ ok: true, taken: 0 });
    expect((await owner().get("/center/autopilot")).body.lastRun.ownerDrawings).toMatchObject({ taken: 0 });
  });
});
