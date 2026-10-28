import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Steadfast's status API is replaced: T-5 says what Steadfast's own record of the parcel is.
const courier = vi.hoisted(() => ({ status: "cancelled" }));
vi.mock("../../providers/courier/steadfast", () => ({
  createSteadfastConsignment: vi.fn(),
  createBulkSteadfastConsignments: vi.fn(),
  getSteadfastBalance: vi.fn(async () => 0),
  getSteadfastFraudCheck: vi.fn(async () => { throw new Error("no courier in tests"); }),
  getSteadfastStatusByConsignmentId: vi.fn(async () => courier.status),
}));
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN, stockOf } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { processFinancialEvent } from "../finance/events.service";
import { runReconciliation } from "../finance/reconciliation.service";
import { handleSteadfastWebhook } from "../../modules/courier/courier.service";
import { listParcelsToReceive, receiveReturnedParcel, reconcilePartialDelivery, updateOrderStatus } from "../../modules/orders/order.service";
import { recordCounts } from "./count.service";
import { stockHub } from "./stock-hub.service";

// The inventory acceptance tests T-1 … T-11 (Revised Decision Register & Risk Plan §4), on the private test database, after
// a real valuation cutover. T-12 / T-13 (White B) are in whiteb-correction.rehearsal.integration.test.ts. Every expected
// value is a literal worked out by hand.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let owner = "";
let seq = Math.floor(Date.now() / 1000) * 1000 + 700;
const consignments: string[] = [];

const as = (r: request.Test) => r.set("Cookie", [`access_token=${signAccessToken({ adminId: owner, role: "OWNER" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);
const buy = (key: string, body: object) => as(request(app).post("/api/v1/finance/stock/purchases")).set("Idempotency-Key", key).send({ paidFrom: { ownerPocket: true }, ...body });
const sum5210 = async () => Number((await prisma.$queryRaw<Array<{ n: string | null }>>`
  SELECT SUM(l.credit - l.debit)::text AS n FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id = l."accountId" WHERE a.code = '5210'`)[0]?.n ?? 0);
const movements = (variantId: string, reason?: string) => prisma.stockMovement.findMany({ where: { variantId, ...(reason ? { reason: reason as never } : {}) }, orderBy: { createdAt: "asc" } });
async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function ship(orderId: string, consignment?: string) {
  if (consignment) await prisma.order.update({ where: { id: orderId }, data: { courierConsignmentId: consignment } });
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] as const) await updateOrderStatus(orderId, { status: s }, owner);
}

beforeAll(async () => {
  await purgeFinanceTables();
  owner = await ownerId();
  OWNER = { type: "ADMIN", adminId: owner, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [15], basePrice: 900 });
  t1 = seed.variants[0]!.id;
  await saveOpeningInventory([{ variantId: t1, sku: "ACC-T1", name: "T-1", quantity: 15, unitCost: 475, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
});

afterAll(async () => {
  await prisma.courierWebhookEvent.deleteMany({ where: { consignmentId: { in: consignments } } });
  await purgeFinanceTables();
  await cleanupFixtures();
});

let t1 = "";

describe("inventory acceptance", () => {
  it("T-1: 10 sold, 5 left; Bought 20 at 475 → stock 25, one PURCHASE_RECEIPT +20, valuation +9,500.00, no 5210 entry", async () => {
    await placeOrder([{ variantId: t1, quantity: 10 }], { customerPhone: "01712000081" });
    expect(await stockOf(t1)).toBe(5);
    await postPending();
    const before5210 = await sum5210();
    const r = await buy(`acc-t1-${RUN}`, { supplierName: "Acceptance Caps", documentTotal: 20, lines: [{ variantId: t1, quantity: 20, amount: 9500 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await postPending();
    expect(await stockOf(t1)).toBe(25);
    const receipts = await movements(t1, "PURCHASE_RECEIPT");
    expect(receipts.map((m) => m.change)).toEqual([20]);
    const entry = await prisma.inventoryValuationEntry.findUniqueOrThrow({ where: { stockMovementId: receipts[0]!.id } });
    expect(Number(entry.valueChange)).toBe(9500);
    expect(await sum5210()).toBe(before5210);
  });

  it("T-2: the same purchase again with the same key, also twice at once → still 25, one movement, one entry", async () => {
    const body = { supplierName: "Acceptance Caps", documentTotal: 20, lines: [{ variantId: t1, quantity: 20, amount: 9500 }] };
    const again = await buy(`acc-t1-${RUN}`, body);
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    const both = await Promise.all([buy(`acc-t1-${RUN}`, body), buy(`acc-t1-${RUN}`, body)]);
    for (const r of both) expect([200, 409]).toContain(r.status);
    expect(await stockOf(t1)).toBe(25);
    expect((await movements(t1, "PURCHASE_RECEIPT")).length).toBe(1);
    expect(await prisma.stockHubEntry.count({ where: { idempotencyKey: { endsWith: `acc-t1-${RUN}` } } })).toBe(1);
  });

  it("T-3: enter 20, three orders of 1 → system stock 17, on the shelf 20 until shipped", async () => {
    const p = await createStockedProduct({ stocks: [0], basePrice: 900 });
    const v = p.variants[0]!.id;
    expect((await buy(`acc-t3-${RUN}`, { documentTotal: 20, lines: [{ variantId: v, quantity: 20, amount: 9500 }] })).status).toBe(201);
    for (const phone of ["01712000082", "01712000083", "01712000084"]) await placeOrder([{ variantId: v, quantity: 1 }], { customerPhone: phone });
    expect(await stockOf(v)).toBe(17);
    const item = (await stockHub({ canSeeCost: true })).groups.flatMap((g) => g.items).find((i) => i.variantId === v)!;
    expect(item).toMatchObject({ stock: 17, reserved: 3, expectedOnShelf: 20 });
  });

  it("T-4: two checkouts at once for the last unit → one order, one refused, stock 0, one ORDER movement", async () => {
    const p = await createStockedProduct({ stocks: [1], basePrice: 900 });
    const v = p.variants[0]!.id;
    const results = await Promise.allSettled([
      placeOrder([{ variantId: v, quantity: 1 }], { customerPhone: "01712000085" }),
      placeOrder([{ variantId: v, quantity: 1 }], { customerPhone: "01712000086" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ statusCode: 409 });
    expect(await stockOf(v)).toBe(0);
    expect((await movements(v, "ORDER")).length).toBe(1);
  });

  it("T-5: the same courier 'cancelled' twice (and once more without a key) → one status change, no restock until received, then exactly one", async () => {
    const p = await createStockedProduct({ stocks: [5], basePrice: 900 });
    const v = p.variants[0]!.id;
    const order = await placeOrder([{ variantId: v, quantity: 1 }], { customerPhone: "01712000087" });
    const consignment = String(++seq);
    consignments.push(consignment);
    await ship(order.id, consignment);
    courier.status = "cancelled";
    const event = { notification_type: "delivery_status", consignment_id: Number(consignment), invoice: "x", status: "Cancelled", updated_at: "2026-10-24 12:00:00" };
    expect(await handleSteadfastWebhook(event, { idempotencyKey: `acc-t5-${consignment}` })).toBe("APPLIED");
    expect(await handleSteadfastWebhook(event, { idempotencyKey: `acc-t5-${consignment}` })).toBe("DUPLICATE");
    await handleSteadfastWebhook(event);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, status: "CANCELLED" } })).toBe(1);
    expect(await stockOf(v)).toBe(4);
    expect((await movements(v)).filter((m) => m.change > 0 && m.orderId === order.id)).toHaveLength(0);
    await receiveReturnedParcel(order.id, owner, {});
    expect(await stockOf(v)).toBe(5);
    expect((await movements(v)).filter((m) => m.change > 0 && m.orderId === order.id)).toHaveLength(1);
  });

  it("T-6: cancelled while packed → +1 at once; cancelled after shipping → nothing until the parcel is received", async () => {
    const p = await createStockedProduct({ stocks: [5], basePrice: 900 });
    const v = p.variants[0]!.id;
    const packed = await placeOrder([{ variantId: v, quantity: 1 }], { customerPhone: "01712000088" });
    const shipped = await placeOrder([{ variantId: v, quantity: 1 }], { customerPhone: "01712000089" });
    expect(await stockOf(v)).toBe(3);
    for (const s of ["CONFIRMED", "PACKED"] as const) await updateOrderStatus(packed.id, { status: s }, owner);
    await updateOrderStatus(packed.id, { status: "CANCELLED", note: "customer cancelled" }, owner);
    expect(await stockOf(v)).toBe(4);
    await ship(shipped.id);
    await updateOrderStatus(shipped.id, { status: "CANCELLED", note: "refused at the door" }, owner);
    expect(await stockOf(v)).toBe(4);
    // blueprint P1.5: the parcel still out is listed to receive; the one cancelled while packed never is
    const waiting = (await listParcelsToReceive()).parcels;
    expect(waiting.find((x) => x.orderId === shipped.id)).toMatchObject({ units: 1, overdue: false, daysOut: 0 });
    expect(waiting.find((x) => x.orderId === packed.id)).toBeUndefined();
    // 15 days later it is a follow-up (owner decision Q-B: 14 days, the store's setting)
    expect((await listParcelsToReceive(new Date(Date.now() + 15 * 86_400_000))).parcels.find((x) => x.orderId === shipped.id)?.overdue).toBe(true);
    // a store that gives parcels 20 days isn't chased at 15
    await updateBusinessSettings({ returnFollowUpDays: 20, reason: "slower courier" }, OWNER);
    const later = await listParcelsToReceive(new Date(Date.now() + 15 * 86_400_000));
    expect(later.followUpDays).toBe(20);
    expect(later.parcels.find((x) => x.orderId === shipped.id)?.overdue).toBe(false);
    await updateBusinessSettings({ returnFollowUpDays: 14, reason: "back to the default" }, OWNER);
    await receiveReturnedParcel(shipped.id, owner, { note: "parcel back from the courier" });
    expect(await stockOf(v)).toBe(5);
    expect((await listParcelsToReceive()).parcels.find((x) => x.orderId === shipped.id)).toBeUndefined();
    await assertInventoryInvariants(v);
  });

  it("T-7 / T-8: partly delivered order of 2, 1 came back → +1 RETURN once; reconciling three times still +1", async () => {
    const p = await createStockedProduct({ stocks: [5], basePrice: 900 });
    const v = p.variants[0]!.id;
    const order = await placeOrder([{ variantId: v, quantity: 2 }], { customerPhone: "01712000090" });
    await ship(order.id);
    await updateOrderStatus(order.id, { status: "PARTIALLY_DELIVERED" }, owner);
    const line = (await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).id;
    await reconcilePartialDelivery(order.id, { items: [{ orderItemId: line, returnedQuantity: 1 }] }, owner);
    for (let i = 0; i < 2; i++) await reconcilePartialDelivery(order.id, { items: [{ orderItemId: line, returnedQuantity: 1 }] }, owner).catch(() => undefined);
    expect(await stockOf(v)).toBe(4);
    expect((await movements(v, "RETURN")).map((m) => m.change)).toEqual([1]);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: line } })).restockedQuantity).toBe(1);
  });

  it("T-9: a grid of XS 8 · S 25 · M 29 · L 19 · XL 2 on a bill of 83, entered as XS 83 · S 8 · M 29 · L 19 → refused, nothing written", async () => {
    const p = await createStockedProduct({ stocks: [0, 0, 0, 0, 0], basePrice: 1450 });
    const [xs, s, m, l, xl] = p.variants.map((x) => x.id);
    const before = await prisma.stockHubEntry.count();
    const r = await buy(`acc-t9-${RUN}`, { documentTotal: 83, lines: [{ variantId: xs, quantity: 83, amount: 48721 }, { variantId: s, quantity: 8, amount: 4696 }, { variantId: m, quantity: 29, amount: 17023 }, { variantId: l, quantity: 19, amount: 11153 }] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain("The lines add up to 139 units but the document says 83");
    expect(await prisma.stockHubEntry.count()).toBe(before);
    // the same grid as a count, XL left off → refused before anything is written
    await expect(recordCounts({ products: [p.product.id], lines: [{ variantId: xs!, counted: 8, reason: "FOUND" }, { variantId: s!, counted: 25, reason: "FOUND" }, { variantId: m!, counted: 29, reason: "FOUND" }, { variantId: l!, counted: 19, reason: "FOUND" }] }, OWNER, `acc-t9c-${RUN}`))
      .rejects.toMatchObject({ details: { code: "COUNT_SCOPE_INCOMPLETE" } });
    for (const id of [xs, s, m, l, xl]) expect(await movements(id!)).toHaveLength(0);
  });

  it("T-10: Inventory › Adjust +50 RESTOCK on a costed variant → refused, pointing to Bought / Filled; no 5210 entry", async () => {
    await postPending();
    const [stock, before5210] = [await stockOf(t1), await sum5210()];
    const r = await as(request(app).post(`/api/inventory/variants/${t1}/adjust`)).send({ delta: 50, reason: "RESTOCK", note: "new stock" });
    expect(r.status).toBe(409);
    expect(r.body.details?.code).toBe("STOCK_VIA_HUB");
    expect(String(r.body.error ?? r.body.message)).toMatch(/Stock › Received goods/);
    await postPending();
    expect(await stockOf(t1)).toBe(stock);
    expect(await sum5210()).toBe(before5210);
  });

  it("T-11: after T-1 … T-10 every inventory check matches", async () => {
    await postPending();
    const r = await runReconciliation({ checks: ["inventory.quantity_vs_valuation", "inventory.valuation_vs_ledger", "inventory.valuation_postings", "ledger.integrity"] }, OWNER);
    expect(Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]))).toEqual({
      "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_vs_ledger": "MATCHED", "inventory.valuation_postings": "MATCHED", "ledger.integrity": "MATCHED",
    });
  });
});
