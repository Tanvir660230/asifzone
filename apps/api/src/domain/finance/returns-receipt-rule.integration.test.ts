import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { contributions, sumOf, type OrderFact } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { checkout, cleanupFixtures, createStockedProduct, markOpeningPostedInTx, ownerId, purgeFinanceTables, RUN, trackOrder } from "../../test-fixtures";
import { createOrder, reconcilePartialDelivery, updateOrderStatus } from "../../modules/orders/order.service";
import { recordItemReturn } from "../../modules/orders/order-adjustments.service";
import { reviewReturnRequest } from "../../modules/return-requests/return-request.service";
import { listAwaitingReturns, receiveAwaitingReturn, withdrawReturnRequest, writeOffUnreturned } from "../../modules/returns/goods-awaiting-return.service";
import { loadOrderFacts } from "../metrics/facts.repository";
import { financeTransaction } from "./finance-tx";
import { getFinanceContext } from "./finance-context";
import { projectOrder, syncCommerce } from "./commerce-accounting.service";
import { runReconciliation } from "./reconciliation.service";
import { updateBusinessSettings } from "./chart.service";
import type { FinanceActor } from "./finance-audit";

// Blueprint P0.4 (owner decisions Q5 = A, Q13 = C, Q13b = B, Q-A, Q-B, Q-C; tab 11 §4 S1–S13, §9 acceptance): with the
// store's returns rule on, an agreed return never restocks — the cost leaves COGS into goods awaiting return (1620) at the
// agreement and comes back into inventory only at the receipt; damaged and never-returned units go to shrinkage.

let admin = "";
let OWNER: FinanceActor;
const customers: string[] = [];
const OWNER_PERMS = ["inventory.approve", "returns.manage"];
const STAFF_PERMS = ["returns.manage"];
const ALL_TIME = { startUtc: new Date("2000-01-01T00:00:00Z"), endUtc: new Date("2100-01-01T00:00:00Z") };

async function accountOf(key: string) {
  const { business } = await getFinanceContext();
  return (await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key } } })).accountId;
}
/** Σ (debit − credit) of the order's posted lines on a mapped account. */
async function dr(orderId: string, key: string): Promise<number> {
  const lines = await prisma.journalLine.findMany({ where: { accountId: await accountOf(key), partyId: orderId, entry: { status: "POSTED" } } });
  return Math.round(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) * 100) / 100 || 0;
}
async function facts(orderId: string): Promise<OrderFact> {
  const [o] = await loadOrderFacts([orderId], "BDT");
  return o!;
}
const engineCogs = async (orderId: string) => sumOf(contributions("cogs", [await facts(orderId)], ALL_TIME)) / 100 || 0;
const returnMovements = (orderId: string) => prisma.stockMovement.findMany({ where: { orderId, reason: "RETURN" } });
const stockOf = async (variantId: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;
const expectationsOf = (orderId: string) => prisma.returnExpectation.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
const eventTypes = async (orderId: string) => (await prisma.financialEvent.findMany({ where: { eventKey: { startsWith: `order:${orderId}:` } } })).map((e) => e.eventType);

async function costedVariant(unitCost: number, price = 1000, stock = 50) {
  const p = await createStockedProduct({ stocks: [stock], basePrice: price });
  await prisma.productVariant.update({ where: { id: p.variants[0]!.id }, data: { costPrice: unitCost } });
  return p.variants[0]!;
}
let phoneSeq = 0;
async function deliveredOrder(items: Array<{ variantId: string; quantity: number }>, to: "DELIVERED" | "SHIPPED" = "DELIVERED") {
  const c = await prisma.customer.create({ data: { name: `P04 ${RUN}`, phone: `0178${RUN.slice(-4)}${String(++phoneSeq).padStart(3, "0")}` } });
  customers.push(c.id);
  const o = await createOrder(checkout(items, { customerPhone: c.phone! }), c.id, {});
  trackOrder(o.id);
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const) {
    await updateOrderStatus(o.id, { status: s }, admin);
    if (s === to) break;
  }
  return prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
}
/** The goods awaiting return balance equals what is still to come back, and the order's books agree with the engine. */
async function consistent(orderId: string) {
  await projectOrder(orderId);
  const [check] = (await runReconciliation({ checks: ["returns.goods_awaiting_return"] }, OWNER)).results;
  expect(check!.status, JSON.stringify(check)).toBe("MATCHED");
  const known = await prisma.journalLine.findMany({ where: { accountId: await accountOf("cogs.goods"), partyId: orderId, valuationStatus: "KNOWN", entry: { status: "POSTED" } } });
  expect(Math.round(known.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) * 100) / 100 || 0, "COGS vs engine").toBe(await engineCogs(orderId));
}

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner", permissions: ["finance.read", "finance.configure", "finance.reconcile", "finance.post"] };
  const ctx = await getFinanceContext();
  await financeTransaction(async (tx) => {
    await tx.financeBusiness.update({ where: { id: ctx.business.id }, data: { openingDate: new Date("2026-01-01T00:00:00Z") } });
    await tx.financeAuditEntry.create({ data: { businessId: ctx.business.id, actorType: "SYSTEM", actorLabel: "test", action: "business.update", entityType: "FinanceBusiness", entityId: ctx.business.id } });
    await markOpeningPostedInTx(tx, ctx.business.id, new Date("2026-01-01T00:00:00Z"));
  });
  expect((await syncCommerce()).skipped).toBeUndefined();
});

afterAll(async () => {
  const ctx = await getFinanceContext();
  await financeTransaction(async (tx) => {
    await tx.financeBusiness.update({ where: { id: ctx.business.id }, data: { returnsReceiptRuleEffectiveAt: null } });
    await tx.financeAuditEntry.create({ data: { businessId: ctx.business.id, actorType: "SYSTEM", actorLabel: "test", action: "business.update", entityType: "FinanceBusiness", entityId: ctx.business.id } });
  });
  await purgeFinanceTables();
  await prisma.customerCreditEntry.deleteMany({ where: { customerId: { in: customers } } });
  await cleanupFixtures();
  await prisma.returnRequest.deleteMany({ where: { customerId: { in: customers } } });
  await prisma.customer.deleteMany({ where: { id: { in: customers } } });
});

describe("turning the rule on (tab 11 §7)", () => {
  it("is off by default: an item return restocks at the approval, as before", async () => {
    const v = await costedVariant(350);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 2 }]);
    await recordItemReturn(o.id, { items: [{ orderItemId: o.items[0]!.id, quantity: 1, restock: true }], reason: "size", compensation: "NONE" }, admin, `p04-off-${o.id}`);
    expect(await returnMovements(o.id)).toHaveLength(1);
    expect(await expectationsOf(o.id)).toHaveLength(0);
  });

  it("is never backdated, and turning it on provisions 1620 Goods awaiting return under 1600 Inventory", async () => {
    const ctx = await getFinanceContext();
    await expect(updateBusinessSettings({ returnsReceiptRuleEffectiveDate: "2026-01-02" }, OWNER)).rejects.toMatchObject({ details: { code: "EFFECTIVE_DATE_IN_PAST" } });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.business.timezone }).format(new Date());
    const s = await updateBusinessSettings({ returnsReceiptRuleEffectiveDate: today }, OWNER);
    expect(s.returnsReceiptRuleEffectiveAt).toBeTruthy();
    const acc = await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: ctx.business.id, code: "1620" }, include: { parent: { select: { code: true } } } });
    expect(acc).toMatchObject({ name: "Goods awaiting return", type: "ASSET", parent: { code: "1600" } });
    expect(await accountOf("asset.goods_awaiting_return")).toBe(acc.id);
  });
});

describe("S1–S13 (tab 11 §4)", () => {
  it("S1 + S2: a return agreed by the order page waits — no RETURN movement, cost in 1620 — then is received into stock", async () => {
    const v = await costedVariant(350);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 3 }]);
    const before = await stockOf(v.id);
    const rr = await recordItemReturn(o.id, { items: [{ orderItemId: o.items[0]!.id, quantity: 1, restock: true }], reason: "size", compensation: "NONE", goodsInHand: false }, admin, `p04-s1-${o.id}`);
    expect(await returnMovements(o.id)).toHaveLength(0);
    expect(await stockOf(v.id)).toBe(before);
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: o.items[0]!.id } })).toMatchObject({ awaitingReturnQuantity: 1, returnedQuantity: 1, restockedQuantity: 0 });
    await consistent(o.id);
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(350);
    expect(await dr(o.id, "cogs.goods")).toBe(2 * 350); // 3 sold, 1 agreed back
    expect(await eventTypes(o.id)).toContain("commerce.return.awaiting");

    await receiveAwaitingReturn(o.id, admin, { lines: [{ orderItemId: o.items[0]!.id, good: 1, damaged: 0 }] });
    const [back] = await returnMovements(o.id);
    expect(back).toMatchObject({ change: 1, sourceType: "ReturnExpectation" });
    expect(await stockOf(v.id)).toBe(before + 1);
    await consistent(o.id);
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(0);
    expect(await dr(o.id, "cogs.goods")).toBe(2 * 350); // COGS untouched by the receipt
    expect(await dr(o.id, "asset.inventory")).toBe(-3 * 350 + 350);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: rr.id } })).status).toBe("COMPLETED");
    // replaying the projection posts nothing new
    const events = await prisma.financialEvent.count({ where: { eventKey: { startsWith: `order:${o.id}:` } } });
    await projectOrder(o.id);
    expect(await prisma.financialEvent.count({ where: { eventKey: { startsWith: `order:${o.id}:` } } })).toBe(events);
  });

  it("S3: received damaged — in and straight out to shrinkage at the recorded cost", async () => {
    const v = await costedVariant(300);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 2 }]);
    const before = await stockOf(v.id);
    await recordItemReturn(o.id, { items: [{ orderItemId: o.items[0]!.id, quantity: 1, restock: true }], reason: "torn", compensation: "NONE", goodsInHand: false }, admin, `p04-s3-${o.id}`);
    await receiveAwaitingReturn(o.id, admin, { lines: [{ orderItemId: o.items[0]!.id, good: 0, damaged: 1 }] });
    expect(await stockOf(v.id)).toBe(before);
    expect((await prisma.stockMovement.findMany({ where: { sourceType: "ReturnExpectation", sourceId: (await expectationsOf(o.id))[0]!.id } })).map((m) => [m.reason, m.change]).sort()).toEqual([["DAMAGED", -1], ["RETURN", 1]]);
    await consistent(o.id);
    expect(await dr(o.id, "cogs.inventory_shrinkage")).toBe(300);
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(0);
  });

  it("S4: a Returned order's parcel comes back 2 of 3 — the third stays awaiting; never more than awaits", async () => {
    const v = await costedVariant(200);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 3 }]);
    await updateOrderStatus(o.id, { status: "RETURNED" }, admin);
    expect(await returnMovements(o.id)).toHaveLength(0);
    await receiveAwaitingReturn(o.id, admin, { lines: [{ orderItemId: o.items[0]!.id, good: 2, damaged: 0 }] });
    await expect(receiveAwaitingReturn(o.id, admin, { lines: [{ orderItemId: o.items[0]!.id, good: 2, damaged: 0 }] })).rejects.toMatchObject({ details: { code: "MORE_THAN_AWAITING" } });
    await consistent(o.id);
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(200);
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: o.items[0]!.id } })).toMatchObject({ awaitingReturnQuantity: 1, restockedQuantity: 2 });
    expect((await listAwaitingReturns()).lines.find((l) => l.orderId === o.id)).toMatchObject({ units: 1, overdue: false, canWriteOff: false });
  });

  it("S5 + S6: an exchange ships the replacement first; the original waits in 1620 and is received later; the replacement is costed at delivery", async () => {
    const p = await createStockedProduct({ stocks: [50, 50], basePrice: 1000 });
    await prisma.productVariant.updateMany({ where: { productId: p.product.id }, data: { costPrice: 400 } });
    const original = p.variants[0]!;
    const replacement = p.variants[1]!;
    const o = await deliveredOrder([{ variantId: original.id, quantity: 1 }]);
    const req = await prisma.returnRequest.create({ data: { orderId: o.id, customerId: o.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: o.items[0]!.id, requestedVariantId: replacement.id } });
    await reviewReturnRequest(req.id, { status: "APPROVED" }, admin);
    const replacementId = (await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).exchangeOrderId!;
    trackOrder(replacementId);
    expect(await returnMovements(o.id)).toHaveLength(0);
    expect((await expectationsOf(o.id)).map((e) => [e.sourceType, e.quantity, e.returnRequestId])).toEqual([["EXCHANGE", 1, req.id]]);
    await consistent(o.id);
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(400);
    for (const s of ["PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const) await updateOrderStatus(replacementId, { status: s }, admin);
    await projectOrder(replacementId);
    expect(await dr(replacementId, "cogs.goods")).toBe(400);
    expect(await dr(replacementId, "asset.inventory")).toBe(-400);
    await receiveAwaitingReturn(o.id, admin, { lines: [{ orderItemId: o.items[0]!.id, good: 1, damaged: 0 }] });
    await consistent(o.id);
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(0);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("COMPLETED");
  });

  it("S7: never returned — only after 30 days; at or over the limit only the owner; shrinkage against 1620 (Q-B, Q-C)", async () => {
    const v = await costedVariant(500);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 3 }]);
    const rr = await recordItemReturn(o.id, { items: [{ orderItemId: o.items[0]!.id, quantity: 3, restock: true }], reason: "kept", compensation: "NONE", goodsInHand: false }, admin, `p04-s7-${o.id}`);
    const [e] = await expectationsOf(o.id);
    await expect(writeOffUnreturned(e!.id, { reason: "Customer kept the item" }, { adminId: admin, permissions: OWNER_PERMS })).rejects.toMatchObject({ details: { code: "TOO_EARLY_TO_WRITE_OFF" } });
    await prisma.returnExpectation.update({ where: { id: e!.id }, data: { approvedAt: new Date(Date.now() - 31 * 86_400_000) } });
    // 3 × ৳500 = ৳1,500 ≥ the ৳1,000 count-loss limit: staff can't
    await expect(writeOffUnreturned(e!.id, { reason: "Customer kept the item" }, { adminId: admin, permissions: STAFF_PERMS })).rejects.toMatchObject({ statusCode: 403, details: { code: "OWNER_APPROVAL_REQUIRED" } });
    await writeOffUnreturned(e!.id, { reason: "Customer kept the item" }, { adminId: admin, permissions: OWNER_PERMS });
    await expect(writeOffUnreturned(e!.id, { reason: "again" }, { adminId: admin, permissions: OWNER_PERMS })).rejects.toMatchObject({ details: { code: "NOT_AWAITING_RETURN" } });
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: o.items[0]!.id } })).toMatchObject({ awaitingReturnQuantity: 0, returnLostQuantity: 3, restockedQuantity: 0 });
    await consistent(o.id);
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(0);
    expect(await dr(o.id, "cogs.inventory_shrinkage")).toBe(1500);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: rr.id } })).status).toBe("COMPLETED");
  });

  it("S7 under the limit: staff may write it off", async () => {
    const v = await costedVariant(200);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 1 }]);
    await updateOrderStatus(o.id, { status: "RETURNED" }, admin);
    const [e] = await expectationsOf(o.id);
    await prisma.returnExpectation.update({ where: { id: e!.id }, data: { approvedAt: new Date(Date.now() - 31 * 86_400_000) } });
    await writeOffUnreturned(e!.id, { reason: "Lost by the courier" }, { adminId: admin, permissions: STAFF_PERMS });
    await consistent(o.id);
  });

  it("S8: withdrawn before anything came back — the agreement and the sales return are reversed; a returned order can't be", async () => {
    const v = await costedVariant(250);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 2 }]);
    const rr = await recordItemReturn(o.id, { items: [{ orderItemId: o.items[0]!.id, quantity: 1, restock: true }], reason: "changed mind", compensation: "NONE", goodsInHand: false }, admin, `p04-s8-${o.id}`);
    await projectOrder(o.id);
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(250);
    await withdrawReturnRequest(rr.id, { reason: "Customer keeps it" }, admin);
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: o.items[0]!.id } })).toMatchObject({ awaitingReturnQuantity: 0, returnedQuantity: 0 });
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: rr.id } })).status).toBe("REJECTED");
    await consistent(o.id);
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(0);
    expect(await dr(o.id, "cogs.goods")).toBe(2 * 250);
    expect(await dr(o.id, "revenue.returns_refunds")).toBe(0);

    const whole = await deliveredOrder([{ variantId: v.id, quantity: 1 }]);
    const req = await prisma.returnRequest.create({ data: { orderId: whole.id, customerId: whole.customerId!, reason: "Wrong", type: "RETURN" } });
    await reviewReturnRequest(req.id, { status: "APPROVED" }, admin);
    expect((await expectationsOf(whole.id))[0]).toMatchObject({ sourceType: "ORDER_RETURNED", returnRequestId: req.id });
    await expect(withdrawReturnRequest(req.id, { reason: "x keeps it" }, admin)).rejects.toMatchObject({ details: { code: "RETURN_NOT_WITHDRAWABLE" } });
    await consistent(whole.id);
  });

  it("S9: rejected before approval — nothing at all", async () => {
    const v = await costedVariant(250);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 1 }]);
    const req = await prisma.returnRequest.create({ data: { orderId: o.id, customerId: o.customerId!, reason: "Wrong", type: "RETURN" } });
    await reviewReturnRequest(req.id, { status: "REJECTED", adminNote: "Worn and washed" }, admin);
    expect(await expectationsOf(o.id)).toHaveLength(0);
    await projectOrder(o.id);
    expect(await eventTypes(o.id)).not.toContain("commerce.return.awaiting");
  });

  it("S10: a partial delivery's refused items are agreed back at the reconcile — their condition is recorded at receipt", async () => {
    const v = await costedVariant(300, 600);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 2 }], "SHIPPED");
    await updateOrderStatus(o.id, { status: "PARTIALLY_DELIVERED" }, admin);
    await expect(reconcilePartialDelivery(o.id, { items: [{ orderItemId: o.items[0]!.id, returnedQuantity: 1, damaged: 1 }] }, admin)).rejects.toMatchObject({ details: { code: "DAMAGE_AT_RECEIPT" } });
    await reconcilePartialDelivery(o.id, { items: [{ orderItemId: o.items[0]!.id, returnedQuantity: 1 }] }, admin);
    expect(await returnMovements(o.id)).toHaveLength(0);
    expect((await expectationsOf(o.id))[0]).toMatchObject({ sourceType: "PARTIAL_DELIVERY", quantity: 1 });
    expect((await expectationsOf(o.id))[0]!.returnRequestId).toBeTruthy();
    await consistent(o.id);
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(300);
    await receiveAwaitingReturn(o.id, admin, { lines: [{ orderItemId: o.items[0]!.id, good: 1, damaged: 0 }] });
    await consistent(o.id);
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(0);
  });

  it("S11: a parcel cancelled after shipping is unchanged — no goods-awaiting-return entry", async () => {
    const v = await costedVariant(300);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 1 }], "SHIPPED");
    await updateOrderStatus(o.id, { status: "CANCELLED", note: "refused at the door" }, admin);
    expect(await expectationsOf(o.id)).toHaveLength(0);
  });

  it("S12: goods in hand on the order page — agreed and received in one step, both posted", async () => {
    const v = await costedVariant(350);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 2 }]);
    const before = await stockOf(v.id);
    const rr = await recordItemReturn(o.id, { items: [{ orderItemId: o.items[0]!.id, quantity: 1, restock: true }], reason: "size", compensation: "NONE" }, admin, `p04-s12-${o.id}`);
    expect(await stockOf(v.id)).toBe(before + 1);
    expect(rr.status).toBe("COMPLETED");
    await consistent(o.id);
    const types = await eventTypes(o.id);
    expect(types).toContain("commerce.return.awaiting");
    expect(types).toContain("commerce.return.received");
    expect(await dr(o.id, "asset.goods_awaiting_return")).toBe(0);
  });

  it("S13: the agreement posts on its own day, the receipt on the receipt's", async () => {
    const v = await costedVariant(150);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 1 }]);
    await updateOrderStatus(o.id, { status: "RETURNED" }, admin);
    const [e] = await expectationsOf(o.id);
    await prisma.returnExpectation.update({ where: { id: e!.id }, data: { approvedAt: new Date("2026-09-15T06:00:00Z") } });
    await receiveAwaitingReturn(o.id, admin, { lines: [{ orderItemId: o.items[0]!.id, good: 1, damaged: 0 }] });
    await consistent(o.id);
    const ev = await prisma.financialEvent.findMany({ where: { eventKey: { startsWith: `order:${o.id}:` }, eventType: { in: ["commerce.return.awaiting", "commerce.return.received"] } } });
    expect(ev.find((x) => x.eventType === "commerce.return.awaiting")!.financialDate.toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(ev.find((x) => x.eventType === "commerce.return.received")!.financialDate.getTime()).toBeGreaterThan(new Date("2026-09-15").getTime());
  });
});

describe("integrity", () => {
  it("two receipts of the last unit at once: one wins, the other is refused; the units are never counted twice", async () => {
    const v = await costedVariant(100);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 1 }]);
    await updateOrderStatus(o.id, { status: "RETURNED" }, admin);
    const before = await stockOf(v.id);
    const results = await Promise.allSettled([1, 2].map(() => receiveAwaitingReturn(o.id, admin, { lines: [{ orderItemId: o.items[0]!.id, good: 1, damaged: 0 }] })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stockOf(v.id)).toBe(before + 1);
    expect(await returnMovements(o.id)).toHaveLength(1);
  });

  it("a whole sweep again records nothing, and the check stays MATCHED", async () => {
    await syncCommerce({ full: true });
    const recorded = await syncCommerce({ full: true });
    expect(recorded.recorded).toBe(0);
    const [check] = (await runReconciliation({ checks: ["returns.goods_awaiting_return"] }, OWNER)).results;
    expect(check!.status).toBe("MATCHED");
  });

  it("turning the rule off: returns agreed from now restock at approval again; what is already awaited can still be received", async () => {
    const v = await costedVariant(120);
    const waiting = await deliveredOrder([{ variantId: v.id, quantity: 1 }]);
    await updateOrderStatus(waiting.id, { status: "RETURNED" }, admin);
    await updateBusinessSettings({ returnsReceiptRuleEffectiveDate: null }, OWNER);
    const o = await deliveredOrder([{ variantId: v.id, quantity: 1 }]);
    await updateOrderStatus(o.id, { status: "RETURNED" }, admin);
    expect(await returnMovements(o.id)).toHaveLength(1);
    await receiveAwaitingReturn(waiting.id, admin, { lines: [{ orderItemId: waiting.items[0]!.id, good: 1, damaged: 0 }] });
    await consistent(waiting.id);
  });
});
