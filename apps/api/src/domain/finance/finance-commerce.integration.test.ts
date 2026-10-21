import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { ROLE_PERMISSIONS, contributions, sumOf, type OrderFact } from "@clothing-brand/shared";
import { listRoutes, routePermission } from "../../test-routes";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { checkout, cleanupFixtures, createStockedProduct, ownerId, markOpeningPostedInTx, placeOrder, purgeFinanceTables, RUN, trackOrder } from "../../test-fixtures";
import { createOrder, updateOrderStatus } from "../../modules/orders/order.service";
import { recordItemReturn } from "../../modules/orders/order-adjustments.service";
import { settlePaymentSession } from "../../modules/payments/payment.service";
import { recordManualPayment, recordRefund } from "../../domain/payments/payment-ledger.service";
import { loadOrderFacts } from "../metrics/facts.repository";
import { financeTransaction } from "./finance-tx";
import { getFinanceContext } from "./finance-context";
import { processFinancialEvent } from "./events.service";
import { approveCostEstimate, projectOrder, syncCommerce } from "./commerce-accounting.service";
import { clearingPosition, createSettlement, importSettlementCsv, postSettlement, reverseSettlement } from "./settlements.service";
import { runReconciliation } from "./reconciliation.service";
import { setCostPolicy } from "./chart.service";
import type { FinanceActor } from "./finance-audit";

// Financial Core Phase 3 (docs/FINANCE_PHASE_3.md §12): commerce → ledger against the real database and the real commerce
// services. Every revenue and COGS expectation is checked against the dashboard's own engine for the same order.

const ALL_TIME = { startUtc: new Date("2000-01-01T00:00:00Z"), endUtc: new Date("2100-01-01T00:00:00Z") };
const SYSTEM: FinanceActor = { type: "SYSTEM", label: "test" };
let admin: string;
let OWNER: FinanceActor;
const madeAdmins: string[] = [];
const customers: string[] = [];

async function facts(orderId: string): Promise<OrderFact> {
  const [o] = await loadOrderFacts([orderId], "BDT");
  return o!;
}
const engine = async (key: string, orderId: string) => sumOf(contributions(key, [await facts(orderId)], ALL_TIME)) / 100 || 0;

async function accountOf(mappingKey: string) {
  const { business } = await getFinanceContext();
  return (await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key: mappingKey } } })).accountId;
}
/** Σ (credit − debit) × sign of the order's posted lines on a mapped account (optionally one valuation only). */
async function ledger(orderId: string, mappingKey: string, sign: 1 | -1 = 1, valuation?: "KNOWN" | "ESTIMATED"): Promise<number> {
  const lines = await prisma.journalLine.findMany({ where: { accountId: await accountOf(mappingKey), partyId: orderId, entry: { status: "POSTED" }, ...(valuation ? { valuationStatus: valuation } : {}) } });
  const v = Math.round(sign * lines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0) * 100) / 100;
  return v === 0 ? 0 : v; // never -0
}
const revenue = async (orderId: string) => (Math.round(((await ledger(orderId, "revenue.merchandise")) + (await ledger(orderId, "revenue.returns_refunds"))) * 100) / 100) || 0;

/** The order's books agree with the dashboard engine: revenue = realised_net_sales, KNOWN COGS = cogs. */
async function agrees(orderId: string) {
  expect(await revenue(orderId), "revenue vs realised_net_sales").toBe(await engine("realised_net_sales", orderId));
  expect(await ledger(orderId, "cogs.goods", -1, "KNOWN"), "COGS vs cogs").toBe(await engine("cogs", orderId));
}

async function costedVariant(unitCost: number | null, price = 1000, stock = 50) {
  const p = await createStockedProduct({ stocks: [stock], basePrice: price });
  if (unitCost !== null) await prisma.productVariant.update({ where: { id: p.variants[0]!.id }, data: { costPrice: unitCost } });
  return p.variants[0]!;
}
async function deliver(orderId: string, to: "DELIVERED" | "SHIPPED" = "DELIVERED") {
  const path = ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const;
  for (const s of path.slice(0, path.indexOf(to) + 1)) await updateOrderStatus(orderId, { status: s }, admin);
}
let phoneSeq = 0;
async function customer() {
  const c = await prisma.customer.create({ data: { name: `P3 ${RUN}`, phone: `0179${RUN.slice(-4)}${String(++phoneSeq).padStart(3, "0")}` } });
  customers.push(c.id);
  return c;
}
async function orderFor(customerId: string, items: Array<{ variantId: string; quantity: number }>, storeCredit = false) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  const o = await createOrder(checkout(items, { customerPhone: c.phone! }), customerId, { storeCreditCustomerId: storeCredit ? customerId : null });
  trackOrder(o.id);
  return o;
}
async function paidOnline(items: Array<{ variantId: string; quantity: number }>, customerId?: string) {
  const o = customerId ? await orderFor(customerId, items) : await placeOrder(items);
  await prisma.order.update({ where: { id: o.id }, data: { paymentMethod: "EPS_PG" } });
  const s = await prisma.paymentSession.create({ data: { orderId: o.id, provider: "EPS_PG", status: "ACTIVE", gatewayTransactionRef: `p3_${o.id}`, expiresAt: new Date(Date.now() + 60_000), amount: o.total } });
  await settlePaymentSession(s.gatewayTransactionRef, `eps_${o.id}`, Number(o.total));
  return prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
}
const eventsOf = (orderId: string) => prisma.financialEvent.findMany({ where: { eventKey: { startsWith: `order:${orderId}:` } }, orderBy: { receivedAt: "asc" } });

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner", permissions: ["finance.read", "finance.transact", "finance.post", "finance.reverse", "finance.reconcile", "finance.configure", "finance.approve_high_value", "finance.sensitive"] };
  const ctx = await getFinanceContext();
  await financeTransaction(async (tx) => {
    await tx.financeBusiness.update({ where: { id: ctx.business.id }, data: { openingDate: new Date("2026-01-01T00:00:00Z") } });
    await tx.financeAuditEntry.create({ data: { businessId: ctx.business.id, actorType: "SYSTEM", actorLabel: "test", action: "business.update", entityType: "FinanceBusiness", entityId: ctx.business.id } });
    await markOpeningPostedInTx(tx, ctx.business.id, new Date("2026-01-01T00:00:00Z"));
  });
  expect((await syncCommerce()).skipped).toBeUndefined();
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.customerCreditEntry.deleteMany({ where: { customerId: { in: customers } } });
  await cleanupFixtures();
  await prisma.returnRequest.deleteMany({ where: { customerId: { in: customers } } });
  await prisma.customer.deleteMany({ where: { id: { in: customers } } });
  await prisma.auditLog.deleteMany({ where: { adminId: { in: madeAdmins } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: madeAdmins } } });
});

describe("set-up", () => {
  it("provisions the commerce accounts once: clearing financial accounts, Phase 3 mappings, sensitive flags", async () => {
    const ctx = await getFinanceContext();
    const fas = await prisma.financialAccount.findMany({ where: { businessId: ctx.business.id } });
    expect(fas.map((f) => [f.name, f.kind]).sort()).toEqual(
      [["COD collections (courier clearing)", "COURIER"], ["EPS clearing", "PAYMENT_GATEWAY"], ["Manual receipts clearing", "OTHER"], ["SSLCommerz clearing", "PAYMENT_GATEWAY"]].sort(),
    );
    expect((await prisma.ledgerAccount.findMany({ where: { businessId: ctx.business.id, isSensitive: true } })).map((a) => a.code).sort()).toEqual(["2410", "2420", "2520", "3100", "3200", "3300", "3350", "6200", "6210"]);
    const again = await syncCommerce();
    expect(again.skipped).toBeUndefined();
    expect(await prisma.financialAccount.count({ where: { businessId: ctx.business.id } })).toBe(4);
  });
});

describe("revenue recognition", () => {
  it("COD: nothing before delivery; at delivery revenue = realised_net_sales, receivable → COD clearing", async () => {
    const v = await costedVariant(400);
    const o = await placeOrder([{ variantId: v.id, quantity: 2 }]);
    await deliver(o.id, "SHIPPED");
    expect((await projectOrder(o.id)).recorded).toHaveLength(0);
    await deliver2(o.id);
    const r = await projectOrder(o.id);
    expect(Object.values(r.outcomes)).toEqual(["posted", "posted"]);
    await agrees(o.id);
    expect(await engine("realised_net_sales", o.id)).toBeGreaterThan(0);
    expect(await ledger(o.id, "asset.receivable_trade")).toBe(0);
    expect(await ledger(o.id, "clearing.cod", -1)).toBe(Number(o.total));
    expect(await ledger(o.id, "asset.inventory")).toBe(800);
    expect((await projectOrder(o.id)).recorded).toHaveLength(0);
  });

  it("online: recognised at the successful payment, into the gateway's clearing account", async () => {
    const v = await costedVariant(300);
    const o = await paidOnline([{ variantId: v.id, quantity: 1 }]);
    await projectOrder(o.id);
    await agrees(o.id);
    expect(await ledger(o.id, "clearing.gateway.eps", -1)).toBe(Number(o.total));
    expect(await ledger(o.id, "asset.receivable_trade")).toBe(0);
    const types = (await eventsOf(o.id)).map((e) => e.eventType).sort();
    expect(types).toEqual(["commerce.order.recognised", "commerce.payment.received"]);
  });

  it("a cancellation before realisation posts nothing; after realisation it reverses revenue and COGS at the cancellation", async () => {
    const v = await costedVariant(250);
    const before = await placeOrder([{ variantId: v.id, quantity: 1 }]);
    await updateOrderStatus(before.id, { status: "CANCELLED" }, admin);
    expect((await projectOrder(before.id)).recorded).toHaveLength(0);

    const paid = await paidOnline([{ variantId: v.id, quantity: 2 }]);
    await projectOrder(paid.id);
    await updateOrderStatus(paid.id, { status: "CANCELLED" }, admin);
    const r = await projectOrder(paid.id);
    expect(r.recorded).toHaveLength(1);
    await agrees(paid.id);
    expect(await engine("realised_net_sales", paid.id)).toBe(0);
    expect(await revenue(paid.id)).toBe(0);
    expect(await ledger(paid.id, "asset.receivable_trade")).toBe(Number(paid.total)); // the customer is owed what they paid
    expect(await ledger(paid.id, "asset.inventory")).toBe(0);
  });

  it("retries, re-runs and concurrent runs never post a fact twice", async () => {
    const v = await costedVariant(100);
    const o = await placeOrder([{ variantId: v.id, quantity: 3 }]);
    await deliver(o.id);
    const runs = await Promise.all([1, 2, 3, 4].map(() => projectOrder(o.id)));
    expect(runs.reduce((s, r) => s + r.recorded.length, 0)).toBe(2);
    for (let i = 0; i < 3; i++) expect((await projectOrder(o.id)).recorded).toHaveLength(0);
    const evs = await eventsOf(o.id);
    expect(evs).toHaveLength(2);
    for (const e of evs) expect(await processFinancialEvent(e.id)).toBe("already_posted");
    expect(await prisma.journalEntry.count({ where: { financialEventId: { in: evs.map((e) => e.id) } } })).toBe(2);
    await agrees(o.id);
  });

  it("sweeps are serialised by a lease that is always released — concurrent sweeps run one at a time, the next one runs", async () => {
    const ctx = await getFinanceContext();
    for (let round = 0; round < 3; round++) {
      const sweeps = await Promise.all([1, 2, 3].map(() => syncCommerce()));
      expect(sweeps.filter((s) => !s.skipped)).toHaveLength(1);
      expect(sweeps.filter((s) => s.skipped).every((s) => s.skipped === "SWEEP_IN_PROGRESS")).toBe(true);
      expect(await prisma.financeSyncState.findUniqueOrThrow({ where: { businessId: ctx.business.id } })).toMatchObject({ leaseToken: null, leaseUntil: null });
      expect((await syncCommerce()).skipped).toBeUndefined();
    }
    // A lease left by a process that died lapses; a live one is respected.
    await prisma.financeSyncState.update({ where: { businessId: ctx.business.id }, data: { leaseToken: "crashed", leaseUntil: new Date(Date.now() + 60_000) } });
    expect((await syncCommerce()).skipped).toBe("SWEEP_IN_PROGRESS");
    await prisma.financeSyncState.update({ where: { businessId: ctx.business.id }, data: { leaseUntil: new Date(Date.now() - 1) } });
    expect((await syncCommerce()).skipped).toBeUndefined();
  });
});

describe("payments, refunds, returns", () => {
  it("a manual payment lands in manual-receipts clearing; COD collects only the balance due", async () => {
    const v = await costedVariant(200);
    const o = await placeOrder([{ variantId: v.id, quantity: 2 }]);
    await recordManualPayment(o.id, { amount: 500, kind: "MANUAL", method: "bKash" }, admin, `p3-manual-${o.id}`);
    await deliver(o.id);
    await projectOrder(o.id);
    expect(await ledger(o.id, "clearing.manual_receipts", -1)).toBe(500);
    expect(await ledger(o.id, "clearing.cod", -1)).toBe(Number(o.total) - 500);
    expect(await ledger(o.id, "asset.receivable_trade")).toBe(0);
    await agrees(o.id);
  });

  it("partial, multiple and repeated refunds reduce revenue exactly as the dashboard does; a repeat records one refund", async () => {
    const v = await costedVariant(300);
    const o = await paidOnline([{ variantId: v.id, quantity: 2 }]);
    await projectOrder(o.id);
    await recordRefund(o.id, { amount: 300, reason: "partial", method: "bKash" }, admin, `p3-ref1-${o.id}`);
    await recordRefund(o.id, { amount: 300, reason: "partial", method: "bKash" }, admin, `p3-ref1-${o.id}`); // retried request
    await projectOrder(o.id);
    await agrees(o.id);
    await recordRefund(o.id, { amount: 200, reason: "second", method: "Cash" }, admin, `p3-ref2-${o.id}`);
    await projectOrder(o.id);
    await agrees(o.id);
    expect(await prisma.refund.count({ where: { orderId: o.id } })).toBe(2);
    expect((await eventsOf(o.id)).filter((e) => e.eventType === "commerce.refund.completed")).toHaveLength(2);
    // Money went back by bKash / cash (no gateway refund): it is owed out of refunds payable until paid from an account.
    const refunds = await prisma.refund.findMany({ where: { orderId: o.id }, include: { payment: true } });
    const expectedSide = refunds.every((r) => r.payment?.provider === "EPS_PG") ? "clearing.gateway.eps" : "liability.refunds_payable";
    expect(await ledger(o.id, expectedSide, expectedSide.startsWith("clearing") ? -1 : 1)).toBe(expectedSide.startsWith("clearing") ? Number(o.total) - 500 : 500);
    expect(await ledger(o.id, "asset.receivable_trade")).toBe(0);
  });

  it("a full refund nets revenue to zero", async () => {
    const v = await costedVariant(300);
    const o = await paidOnline([{ variantId: v.id, quantity: 1 }]);
    await recordRefund(o.id, { amount: Number(o.total), reason: "full", method: "bKash" }, admin, `p3-full-${o.id}`);
    await projectOrder(o.id);
    await agrees(o.id);
    expect(await engine("realised_net_sales", o.id)).toBe(0);
  });

  it("a sellable return restores inventory and reverses COGS at the recorded cost; a damaged one is written off", async () => {
    const cust = await customer();
    const v = await costedVariant(350);
    const o = await orderFor(cust.id, [{ variantId: v.id, quantity: 3 }]);
    await deliver(o.id);
    const items = await prisma.orderItem.findMany({ where: { orderId: o.id } });
    await recordItemReturn(o.id, { items: [{ orderItemId: items[0]!.id, quantity: 1, restock: true }], reason: "size", compensation: "STORE_CREDIT" }, admin, `p3-ret1-${o.id}`);
    await recordItemReturn(o.id, { items: [{ orderItemId: items[0]!.id, quantity: 1, restock: false }], reason: "torn", compensation: "STORE_CREDIT" }, admin, `p3-ret2-${o.id}`);
    await projectOrder(o.id);
    await agrees(o.id);
    expect(await engine("cogs", o.id)).toBe(350); // 3 sold − 2 returned (both came back into stock first)
    expect(await ledger(o.id, "cogs.inventory_shrinkage", -1)).toBe(350); // the damaged one written off
    expect(await ledger(o.id, "asset.inventory")).toBe(3 * 350 - 2 * 350 + 350); // credit − debit: down by the 2 units kept / written off
    // Store credit given for both: a liability; the returns settled in credit show as a return, revenue as the dashboard keeps it.
    const credited = await prisma.customerCreditEntry.aggregate({ where: { customerId: cust.id }, _sum: { amount: true } });
    expect(await ledger(o.id, "liability.store_credit")).toBe(Number(credited._sum.amount));
    expect(await ledger(o.id, "revenue.store_credit_returns", -1)).toBe(Number(credited._sum.amount));
  });
});

describe("store credit", () => {
  it("issue, partial and full redemption: the liability follows the credit ledger; the reserved balance nets to zero", async () => {
    const cust = await customer();
    const v = await costedVariant(100, 600);
    const first = await orderFor(cust.id, [{ variantId: v.id, quantity: 2 }]);
    await deliver(first.id);
    const items = await prisma.orderItem.findMany({ where: { orderId: first.id } });
    await recordItemReturn(first.id, { items: [{ orderItemId: items[0]!.id, quantity: 2, restock: true }], reason: "changed mind", compensation: "STORE_CREDIT" }, admin, `p3-sc-${first.id}`);
    const balance = Number((await prisma.customerCreditEntry.aggregate({ where: { customerId: cust.id }, _sum: { amount: true } }))._sum.amount);
    expect(balance).toBeGreaterThan(0);
    const partial = await orderFor(cust.id, [{ variantId: v.id, quantity: 3 }], true); // costs more than the balance
    const full = await orderFor(cust.id, [{ variantId: v.id, quantity: 1 }]);
    for (const id of [first.id, partial.id, full.id]) await projectOrder(id);
    await syncCommerce();
    const { business } = await getFinanceContext();
    const lines = await prisma.journalLine.findMany({ where: { accountId: await accountOf("liability.store_credit"), entry: { status: "POSTED", businessId: business.id }, OR: [{ partyId: { in: [first.id, partial.id, full.id] } }, { partyId: cust.id }] } });
    const liability = lines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
    const ledgerBalance = Number((await prisma.customerCreditEntry.aggregate({ where: { customerId: cust.id }, _sum: { amount: true } }))._sum.amount);
    expect(Math.round(liability * 100) / 100).toBe(ledgerBalance);
    expect(await ledger(partial.id, "liability.store_credit_reserved")).toBe(0);
    expect((await eventsOf(partial.id)).some((e) => e.eventType === "commerce.store_credit.entry")).toBe(true);
    // Retried: nothing new.
    for (const id of [first.id, partial.id]) expect((await projectOrder(id)).recorded).toHaveLength(0);
  });
});

describe("cost states", () => {
  it("a missing cost is never invented: an exception names the line, COGS excludes it like the dashboard; mixed orders book the known line", async () => {
    const known = await costedVariant(200);
    const unknown = await costedVariant(null);
    const o = await placeOrder([{ variantId: known.id, quantity: 1 }, { variantId: unknown.id, quantity: 2 }]);
    await deliver(o.id);
    await projectOrder(o.id);
    await agrees(o.id);
    expect(await ledger(o.id, "cogs.goods", -1)).toBe(200);
    const ex = await prisma.financeException.findMany({ where: { orderId: o.id, kind: "MISSING_COST" } });
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ status: "OPEN", sourceType: "OrderItem" });
    const recognition = (await eventsOf(o.id)).find((e) => e.eventType === "commerce.order.recognised")!;
    expect((recognition.payload as { missingCost: unknown[] }).missingCost).toHaveLength(1);
  });

  it("an estimate posts only under the APPROVED_ESTIMATES policy, supersedes the recognition, and stays labelled ESTIMATED", async () => {
    const unknown = await costedVariant(null);
    const o = await placeOrder([{ variantId: unknown.id, quantity: 2 }]);
    await deliver(o.id);
    await projectOrder(o.id);
    const ex = await prisma.financeException.findFirstOrThrow({ where: { orderId: o.id, kind: "MISSING_COST" } });
    await expect(approveCostEstimate(ex.id, 150, "supplier quote", OWNER)).rejects.toMatchObject({ details: { code: "ESTIMATES_NOT_PERMITTED" } });
    await setCostPolicy({ costPolicy: "APPROVED_ESTIMATES", reason: "owner allows estimates" }, OWNER);
    const r = await approveCostEstimate(ex.id, 150, "supplier quote", OWNER);
    expect(Object.values(r.outcomes)).toContain("posted");
    expect(await ledger(o.id, "cogs.goods", -1, "ESTIMATED")).toBe(300);
    expect(await ledger(o.id, "cogs.goods", -1, "KNOWN")).toBe(0);
    await agrees(o.id); // KNOWN COGS still equals the dashboard (which never counts an estimate)
    const recs = (await eventsOf(o.id)).filter((e) => e.eventType === "commerce.order.recognised");
    expect(recs.map((e) => e.status)).toEqual(["POSTED", "POSTED"]);
    const firstJournal = await prisma.journalEntry.findUniqueOrThrow({ where: { financialEventId: recs[0]!.id }, include: { reversedBy: true } });
    expect(firstJournal.reversedBy).not.toBeNull(); // superseded = reversed, never edited
    expect(await revenue(o.id)).toBe(await engine("realised_net_sales", o.id));
    await setCostPolicy({ costPolicy: "KNOWN_ONLY", reason: "back to known only" }, OWNER);
  });
});

describe("clearing settlements", () => {
  it("a COD settlement with the actual fee and adjustment clears the orders it names; partial and unmatched lines are visible", async () => {
    const v = await costedVariant(100, 500);
    const a = await placeOrder([{ variantId: v.id, quantity: 2 }]);
    const b = await placeOrder([{ variantId: v.id, quantity: 1 }]);
    for (const o of [a, b]) {
      await deliver(o.id);
      await projectOrder(o.id);
    }
    const ctx = await getFinanceContext();
    const cod = await prisma.financialAccount.findFirstOrThrow({ where: { businessId: ctx.business.id, kind: "COURIER" } });
    const bank = await prisma.financialAccount.create({ data: { businessId: ctx.business.id, kind: "BANK", name: `P3 bank ${RUN}`, currency: "BDT", ledgerAccountId: (await financeTransaction(async (tx) => {
      const la = await tx.ledgerAccount.create({ data: { businessId: ctx.business.id, code: `12${RUN.slice(-2)}9`, name: "P3 bank", type: "ASSET", normalBalance: "DEBIT" } });
      await tx.financeAuditEntry.create({ data: { actorType: "SYSTEM", actorLabel: "t", action: "x", entityType: "LedgerAccount", entityId: la.id } });
      return la;
    })).id } }).catch(async () => null);
    expect(bank).toBeNull(); // a financial account needs its audit entry — created the proper way below
    const owner = agent(admin, "OWNER");
    const bankRes = await owner.post("/financial-accounts", { kind: "BANK", name: `P3 bank ${RUN}` });
    expect(bankRes.status).toBe(201);
    const input = {
      clearingFinancialAccountId: cod.id, destinationFinancialAccountId: bankRes.body.id, settlementDate: "2026-10-07", reference: `STF-${RUN}`,
      evidence: "Steadfast payout statement", adjustmentReason: "COD return charge",
      lines: [
        { orderNumber: a.orderNumber, amount: Number(a.total), fee: 20, adjustment: 0 },
        { orderNumber: b.orderNumber, amount: Number(b.total) - 100, fee: 10, adjustment: 5 }, // partial: 100 still at the courier
        { orderNumber: "NOT-AN-ORDER", amount: 50 },
      ],
    };
    const created = await createSettlement(input, OWNER, `p3-set-${RUN}`);
    expect(created.settlement).toMatchObject({ status: "DRAFT", feeAmount: 30, adjustmentAmount: 5, unmatchedLines: 1 });
    expect((await createSettlement(input, OWNER, `p3-set-${RUN}`)).replayed).toBe(true);
    await expect(createSettlement(input, OWNER, `p3-set-other-${RUN}`)).rejects.toMatchObject({ details: { code: "SETTLEMENT_REFERENCE_EXISTS" } });
    const posted = await postSettlement(created.settlement.id, OWNER);
    expect(posted.settlement.status).toBe("POSTED");
    expect((await postSettlement(created.settlement.id, OWNER)).alreadyPosted).toBe(true);
    const gross = Number(a.total) + Number(b.total) - 100 + 50;
    const j = await prisma.journalEntry.findUniqueOrThrow({ where: { id: posted.settlement.journalEntryId! }, include: { lines: true } });
    expect(Number(j.totalDebit)).toBe(gross);
    expect(await ledger(a.id, "clearing.cod", -1)).toBe(0);
    expect(await ledger(b.id, "clearing.cod", -1)).toBe(100);
    expect(await prisma.financeException.count({ where: { kind: "UNMATCHED_SETTLEMENT_LINE", details: { path: ["orderNumber"], equals: "NOT-AN-ORDER" } } })).toBe(1);
    const recon = await runReconciliation({ checks: ["clearing.positions"] }, OWNER);
    expect(recon.results[0]).toMatchObject({ status: "DIFFERENCE" });
    // Immutable once posted; reversed, never edited.
    await expect(prisma.clearingSettlement.update({ where: { id: created.settlement.id }, data: { feeAmount: 0, netAmount: gross } })).rejects.toThrow(/immutable|FINANCE_AUDIT_REQUIRED|check/i);
    const rev = await reverseSettlement(created.settlement.id, "statement withdrawn", OWNER);
    expect(rev.settlement.status).toBe("REVERSED");
    expect(await ledger(a.id, "clearing.cod", -1)).toBe(Number(a.total));
    // The reversal un-settles the order — it is not a second collection.
    const position = (await clearingPosition(cod.id)).openOrders.find((p) => p.orderId === a.id);
    expect(position).toMatchObject({ received: Number(a.total), settled: 0, open: Number(a.total) });
  });

  it("a gateway settlement statement (CSV) imports once, matches by the gateway's transaction id and books its actual fee", async () => {
    const v = await costedVariant(100, 800);
    const o = await paidOnline([{ variantId: v.id, quantity: 1 }]);
    await projectOrder(o.id);
    const ctx = await getFinanceContext();
    const eps = await prisma.financialAccount.findFirstOrThrow({ where: { businessId: ctx.business.id, name: "EPS clearing" } });
    const bank = await prisma.financialAccount.findFirstOrThrow({ where: { businessId: ctx.business.id, kind: "BANK" } });
    const csv = `Txn Id,Gross,Charge\neps_${o.id},${Number(o.total).toFixed(2)},16.00\n`;
    const input = { clearingFinancialAccountId: eps.id, destinationFinancialAccountId: bank.id, settlementDate: "2026-10-07", reference: `EPS-${RUN}`, csv, mapping: { externalRef: "Txn Id", amount: "Gross", fee: "Charge" }, hasHeader: true, skipRows: 0 };
    const first = await importSettlementCsv(input, OWNER);
    const again = await importSettlementCsv(input, OWNER);
    expect(again).toMatchObject({ replayed: true, settlement: { id: first.settlement.id } });
    expect(first.settlement.lines[0]).toMatchObject({ orderId: o.id, matchStatus: "MATCHED", fee: 16 });
    await postSettlement(first.settlement.id, OWNER);
    expect(await ledger(o.id, "clearing.gateway.eps", -1)).toBe(0);
    const fee = await prisma.journalLine.findMany({ where: { accountId: await accountOf("expense.gateway_fees"), entryId: (await prisma.clearingSettlement.findUniqueOrThrow({ where: { id: first.settlement.id } })).journalEntryId! } });
    expect(Number(fee[0]!.debit)).toBe(16);
  });
});

describe("refund after settlement", () => {
  it("a gateway refund after the order was settled is credited to gateway clearing and shown as awaiting deduction, not as an error", async () => {
    const v = await costedVariant(100, 700);
    const o = await paidOnline([{ variantId: v.id, quantity: 1 }]);
    await projectOrder(o.id);
    const ctx = await getFinanceContext();
    const eps = await prisma.financialAccount.findFirstOrThrow({ where: { businessId: ctx.business.id, name: "EPS clearing" } });
    const bank = await prisma.financialAccount.findFirstOrThrow({ where: { businessId: ctx.business.id, kind: "BANK" } });
    const s = await createSettlement({ clearingFinancialAccountId: eps.id, destinationFinancialAccountId: bank.id, settlementDate: "2026-10-07", reference: `EPS2-${RUN}`, lines: [{ externalRef: `eps_${o.id}`, amount: Number(o.total) }] }, OWNER, `p3-eps2-${RUN}`);
    await postSettlement(s.settlement.id, OWNER);
    expect(await ledger(o.id, "clearing.gateway.eps", -1)).toBe(0);
    await recordRefund(o.id, { amount: 200, reason: "after payout", method: "EPS" }, admin, `p3-after-${o.id}`);
    await projectOrder(o.id);
    await agrees(o.id);
    expect(await ledger(o.id, "clearing.gateway.eps", -1)).toBe(-200); // the gateway owes this back out of a later payout
    const recon = await runReconciliation({ checks: ["clearing.positions"] }, OWNER);
    const epsRow = (recon.results[0]!.details as { accounts: Array<{ key: string; oversettled: unknown[]; refundsAwaitingDeduction: number }> }).accounts.find((a) => a.key === "clearing.gateway.eps")!;
    expect(epsRow.oversettled).toEqual([]);
    expect(epsRow.refundsAwaitingDeduction).toBeGreaterThanOrEqual(1);
  });
});

describe("invariants", () => {
  it("every commerce journal balances, is audited, carries the brand, and can't be edited; the reconciliation agrees with the dashboard", async () => {
    const ctx = await getFinanceContext();
    const commerceJournals = await prisma.journalEntry.findMany({ where: { businessId: ctx.business.id, financialEvent: { sourceSystem: "commerce" } }, include: { lines: true } });
    expect(commerceJournals.length).toBeGreaterThan(20);
    for (const j of commerceJournals) {
      const d = j.lines.reduce((s, l) => s + Number(l.debit), 0);
      const c = j.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(Math.round(d * 100), j.id).toBe(Math.round(c * 100));
      expect(j.brandId).toBe(ctx.brand.id);
    }
    const unaudited = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM (
        SELECT id FROM "JournalEntry" x WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'JournalEntry' AND f."entityId" = x.id)
        UNION ALL SELECT id FROM "FinanceException" x WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'FinanceException' AND f."entityId" = x.id)
        UNION ALL SELECT id FROM "ClearingSettlement" x WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'ClearingSettlement' AND f."entityId" = x.id)) q`;
    expect(Number(unaudited[0]!.n)).toBe(0);
    await expect(prisma.journalEntry.update({ where: { id: commerceJournals[0]!.id }, data: { description: "edited" } })).rejects.toThrow(/immutable/);
    await expect(prisma.financeException.deleteMany({ where: { businessId: ctx.business.id } })).rejects.toThrow(/never deleted/);
    const recon = await runReconciliation({ checks: ["revenue.dashboard_vs_ledger", "cogs.dashboard_vs_ledger", "commerce.facts_posted", "commerce.duplicates", "ledger.integrity", "events.unposted"] }, OWNER);
    const byKey = Object.fromEntries(recon.results.map((r) => [r.checkKey, r]));
    expect(byKey["revenue.dashboard_vs_ledger"], JSON.stringify(byKey["revenue.dashboard_vs_ledger"]?.details)).toMatchObject({ status: "MATCHED" });
    expect(byKey["cogs.dashboard_vs_ledger"], JSON.stringify(byKey["cogs.dashboard_vs_ledger"]?.details)).toMatchObject({ status: "MATCHED" });
    expect(byKey["commerce.facts_posted"], JSON.stringify(byKey["commerce.facts_posted"]?.details)).toMatchObject({ status: "MATCHED" });
    expect(byKey["commerce.duplicates"]).toMatchObject({ status: "MATCHED" });
    expect(byKey["ledger.integrity"]).toMatchObject({ status: "MATCHED" });
    expect(byKey["events.unposted"]).toMatchObject({ status: "MATCHED" });
    expect((await prisma.financialEvent.findMany({ where: { sourceSystem: "commerce", businessId: ctx.business.id } })).every((e) => e.brandId === ctx.brand.id)).toBe(true);
  });

  it("a fact in a closed period is corrected in the next open one; the closed period never changes", async () => {
    const v = await costedVariant(null);
    const o = await placeOrder([{ variantId: v.id, quantity: 1 }]);
    await deliver(o.id);
    await projectOrder(o.id);
    const recognition = await prisma.journalEntry.findFirstOrThrow({ where: { financialEvent: { eventKey: { startsWith: `order:${o.id}:recognition` } } } });
    const ctx = await getFinanceContext();
    await financeTransaction(async (tx) => {
      await tx.financialPeriod.update({ where: { id: recognition.periodId }, data: { status: "CLOSED", closedAt: new Date() } });
      await tx.financeAuditEntry.create({ data: { businessId: ctx.business.id, actorType: "SYSTEM", actorLabel: "test", action: "period.close", entityType: "FinancialPeriod", entityId: recognition.periodId } });
    });
    await setCostPolicy({ costPolicy: "APPROVED_ESTIMATES", reason: "test" }, OWNER);
    const ex = await prisma.financeException.findFirstOrThrow({ where: { orderId: o.id, kind: "MISSING_COST" } });
    const r = await approveCostEstimate(ex.id, 90, "late quote", OWNER);
    expect(Object.values(r.outcomes)).toEqual(["posted"]);
    const later = await prisma.journalEntry.findMany({ where: { financialEvent: { eventKey: { startsWith: `order:${o.id}:recognition` } }, id: { not: recognition.id } } });
    const reversal = await prisma.journalEntry.findFirstOrThrow({ where: { reversesEntryId: recognition.id } });
    for (const j of [...later, reversal]) expect(j.periodId).not.toBe(recognition.periodId);
    await financeTransaction(async (tx) => {
      await tx.financialPeriod.update({ where: { id: recognition.periodId }, data: { status: "OPEN", closedAt: null } });
      await tx.financeAuditEntry.create({ data: { businessId: ctx.business.id, actorType: "SYSTEM", actorLabel: "test", action: "period.reopen", entityType: "FinancialPeriod", entityId: recognition.periodId } });
    });
    await setCostPolicy({ costPolicy: "KNOWN_ONLY", reason: "test" }, OWNER);
  });
});

// ── roles (HTTP) ───────────────────────────────────────────────────────────────────────────────────────────────────

const CSRF = "vitest-csrf";
function agent(adminId: string, role: "OWNER" | "STAFF" | "FINANCE_ADMIN" | "ACCOUNTANT" | "FINANCE_VIEWER") {
  const cookie = [`access_token=${signAccessToken({ adminId, role })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/v1/finance${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
    put: (url: string, body: object = {}) => auth(request(app).put(`/api/v1/finance${url}`)).send(body),
  };
}
async function adminWith(role: "STAFF" | "FINANCE_ADMIN" | "ACCOUNTANT" | "FINANCE_VIEWER") {
  const a = await prisma.adminUser.create({ data: { name: `P3 ${role}`, email: `p3-${role.toLowerCase()}-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role } });
  madeAdmins.push(a.id);
  return agent(a.id, role);
}
// `deliver` without SHIPPED again (helper for an order already shipped).
async function deliver2(orderId: string) {
  await updateOrderStatus(orderId, { status: "DELIVERED" }, admin);
}

describe("finance roles (server-side)", () => {
  it("each role reaches exactly its share; ordinary staff reach nothing; sensitive balances and high-value approval stay with the owner", async () => {
    const [staff, fadmin, accountant, viewer] = await Promise.all([adminWith("STAFF"), adminWith("FINANCE_ADMIN"), adminWith("ACCOUNTANT"), adminWith("FINANCE_VIEWER")]);
    const owner = agent(admin, "OWNER");
    // read
    for (const a of [fadmin, accountant, viewer]) expect((await a.get("/commerce/status")).status).toBe(200);
    expect((await staff.get("/commerce/status")).status).toBe(403);
    // reconcile (sync)
    expect((await accountant.post("/commerce/sync", {})).status).toBe(200);
    expect((await viewer.post("/commerce/sync", {})).status).toBe(403);
    // post a settlement: finance admin yes, accountant no
    const drafts = await owner.get("/settlements?status=DRAFT");
    expect(drafts.status).toBe(200);
    expect((await accountant.post(`/settlements/x/post`)).status).toBe(403);
    expect((await fadmin.post(`/settlements/x/post`)).status).toBe(404); // allowed through; no such settlement
    // configuration and cost policy: owner only
    for (const a of [fadmin, accountant, viewer, staff]) expect((await a.put("/business/cost-policy", { costPolicy: "KNOWN_ONLY", reason: "try it" })).status).toBe(403);
    expect((await owner.put("/business/cost-policy", { costPolicy: "KNOWN_ONLY", reason: "same" })).status).toBe(200);
    // sensitive: owner capital's ledger and balance
    const accounts = (await fadmin.get("/accounts")).body.accounts as Array<{ code: string; id: string; balance: number | null; restricted: boolean }>;
    const capital = accounts.find((a) => a.code === "3100")!;
    expect(capital).toMatchObject({ restricted: true, balance: null });
    expect((await fadmin.get(`/accounts/${capital.id}/ledger`)).status).toBe(403);
    expect((await owner.get(`/accounts/${capital.id}/ledger`)).status).toBe(200);
    const tb = (await viewer.get("/trial-balance")).body;
    expect(tb.balanced).toBe(true);
    expect(tb.rows.some((r: { code: string }) => r.code === "3100")).toBe(false);
    // An accountant's movement waits for approval; a high-value approval is the owner's even for a finance admin.
    const ctx = await getFinanceContext();
    const cashRes = await owner.post("/financial-accounts", { kind: "CASH", name: `P3 cash ${RUN}`, approvalThreshold: 1000 });
    const capitalId = capital.id;
    const small = await accountant.post("/movements/deposit", { toFinancialAccountId: cashRes.body.id, counterAccountId: capitalId, amount: 100, movementDate: "2026-10-07", description: "float" }, `p3-acc-${RUN}`);
    expect(small.status, JSON.stringify(small.body)).toBe(201);
    expect(small.body.movement.status).toBe("PENDING_APPROVAL");
    expect((await fadmin.post(`/movements/${small.body.movement.id}/approve`)).status).toBe(200);
    const big = await accountant.post("/movements/deposit", { toFinancialAccountId: cashRes.body.id, counterAccountId: capitalId, amount: 5000, movementDate: "2026-10-07", description: "big float" }, `p3-acc-big-${RUN}`);
    const denied = await fadmin.post(`/movements/${big.body.movement.id}/approve`);
    expect([denied.status, denied.body.details.code]).toEqual([403, "HIGH_VALUE_APPROVAL_REQUIRED"]);
    expect((await owner.post(`/movements/${big.body.movement.id}/approve`)).body.movement.status).toBe("POSTED");
    void ctx;
    void SYSTEM;
  });
});

describe("finance roles × every admin route", () => {
  it("FINANCE_ADMIN, ACCOUNTANT and FINANCE_VIEWER are refused exactly where their permissions don't reach — commerce included", async () => {
    const routes = listRoutes().filter((r) => routePermission(r) !== null);
    const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, "p3-missing").replace(/\/$/, "") || "/";
    // Side effects too broad to fire blind (exercised by their own suites).
    const SKIP = new Set(["POST /api/v1/storefront/read-model/rebuild", "POST /api/payment-admin/ledger/repair", "POST /api/auth/logout-all"]);
    for (const role of ["FINANCE_ADMIN", "ACCOUNTANT", "FINANCE_VIEWER"] as const) {
      const a = await prisma.adminUser.create({ data: { name: `P3 sweep ${role}`, email: `p3-sweep-${role.toLowerCase()}-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role } });
      madeAdmins.push(a.id);
      const cookie = [`access_token=${signAccessToken({ adminId: a.id, role })}`, `csrf_token=${CSRF}`];
      const wrong: string[] = [];
      let allowed = 0;
      for (const r of routes) {
        const key = `${r.method} ${r.path}`;
        if (SKIP.has(key)) continue;
        const perm = routePermission(r)!;
        const may = perm === "(self)" || perm.split(",").every((p) => (ROLE_PERMISSIONS[role] as readonly string[]).includes(p));
        const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[r.method.toLowerCase()]!(concrete(r.path)).set("Cookie", cookie).set("X-CSRF-Token", CSRF).send({});
        if (res.status === 401) wrong.push(`${key} → 401`);
        else if ((res.status === 403) !== !may && !(may && res.status === 403 && res.body?.details?.code)) wrong.push(`${key} (${perm}) → ${res.status}`);
        if (may) allowed += 1;
      }
      expect(wrong, role).toEqual([]);
      expect(allowed, role).toBeGreaterThan(0);
    }
  });
});
