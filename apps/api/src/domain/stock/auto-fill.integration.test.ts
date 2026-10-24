import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { prisma } from "../../config/prisma";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN, stockOf } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { approvePurchaseOrder, createPurchaseOrder, submitPurchaseOrder } from "../finance/purchase-orders.service";
import { createGoodsReceipt, postGoodsReceipt } from "../finance/goods-receipts.service";
import { createSupplier } from "../finance/suppliers.service";
import { processFinancialEvent } from "../finance/events.service";
import { runReconciliation } from "../finance/reconciliation.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { approveBom, createBom } from "../manufacturing/boms.service";
import { bookOrderWithSteadfast, bookOrdersWithSteadfastBulk } from "../../modules/courier/courier.service";
import { fillCapacityChanged } from "./fill-capacity.service";
import { fillForBookedOrder, retryAutoFill } from "./auto-fill.service";
import { recordFill } from "./fill.service";
import { stockToday } from "./stock-today.service";

// Smart stock page, task 6 (owner decision 2026-10-24): booking an attar parcel records the fill of the bottles still owed
// for it — the booking never fails because of the fill, and a fill that can't be made waits on Today. Steadfast is stubbed.

const realFetch = globalThis.fetch;
let restoreSteadfast: () => void = () => {};
let consignment = Math.floor(Date.now() / 1000) * 1000 + 700;
let OWNER: FinanceActor;
let supplierId = "";
let oil = "";
let dryOil = "";
let bottle = "";
let cap = "";
let key = 0;

function stubSteadfast() {
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (!url.includes("steadfast.invalid")) return realFetch(input as string, init as RequestInit);
    if (!url.includes("/create_order")) return new Response("{}", { status: 404 });
    const body = JSON.parse(String(init?.body));
    if (url.endsWith("/create_order/bulk-order")) {
      const payload = JSON.parse(body.data) as Array<{ invoice: string }>;
      return new Response(JSON.stringify({ status: 200, data: payload.map((p) => ({ invoice: p.invoice, consignment_id: ++consignment, tracking_code: `TRK${consignment}`, status: "success" })) }), { status: 200 });
    }
    consignment++;
    return new Response(JSON.stringify({ status: 200, consignment: { consignment_id: consignment, tracking_code: `TRK-A${consignment}`, status: "in_review", tracking_link: "https://t.invalid" } }), { status: 200 });
  }) as typeof fetch;
}

async function buy(variantId: string, qty: number, unitPrice: number) {
  const po = await createPurchaseOrder({ supplierId, lines: [{ lineType: "STOCK", variantId, qtyOrdered: qty, unitPrice }] } as never, OWNER);
  await submitPurchaseOrder(po.id, OWNER);
  const approved = await approvePurchaseOrder(po.id, OWNER);
  const grn = await createGoodsReceipt({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: approved.lines[0]!.id, qtyAccepted: qty }] } as never, OWNER);
  await postGoodsReceipt(grn.id, {}, OWNER);
}
const material = async (name: string, unit: string) =>
  (await createMaterial({ name: `Vitest ${name} ${RUN}`, stockUnit: unit, variants: [{ sku: `AF-${name.replace(/\W/g, "")}-${RUN}`, spec: name }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
async function attarOf(oilId: string, policy: "TRACKED" | "UNLIMITED" = "TRACKED") {
  const p = await createStockedProduct({ stocks: [0], basePrice: 350 });
  await prisma.product.update({ where: { id: p.product.id }, data: { fillToOrder: true, stockPolicy: policy } });
  const bom = await createBom({ productId: p.product.id, lines: [{ materialVariantId: oilId, qtyPerUnit: "6", wastagePct: "0" }, { materialVariantId: bottle, qtyPerUnit: "1", wastagePct: "0" }] } as never, OWNER);
  await approveBom(bom.id, OWNER);
  fillCapacityChanged();
  return p.variants[0]!.id;
}
async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function booksMatch() {
  await postPending();
  const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity"] }, OWNER);
  return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
}
const MATCHED = { "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "ledger.integrity": "MATCHED" };
const booked = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { courierConsignmentId: true } })).courierConsignmentId;
const failures = (orderId: string) => prisma.stockAutoFillFailure.findMany({ where: { orderId } });

beforeAll(async () => {
  restoreSteadfast = overrideIntegrationsForTests({ STEADFAST_API_KEY: "test-key", STEADFAST_SECRET_KEY: "test-secret", STEADFAST_BASE_URL: "https://steadfast.invalid/api/v1" });
  stubSteadfast();
  await purgeFinanceTables();
  OWNER = { type: "ADMIN", adminId: await ownerId(), label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const c = await createStockedProduct({ stocks: [10], basePrice: 900 });
  cap = c.variants[0]!.id;
  await saveOpeningInventory([{ variantId: cap, sku: c.variants[0]!.sku, name: "cap", quantity: 10, unitCost: 460, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: (await getFinanceContext()).brand.id }] as never, OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  supplierId = (await createSupplier({ legalName: "Vitest Auto-fill House" } as never, OWNER)).id;
  oil = await material("AF oil", "ml");
  dryOil = await material("AF dry oil", "ml");
  bottle = await material("AF bottle", "pcs");
  await buy(oil, 120, 5); // 20 bottles' worth
  await buy(bottle, 100, 10);
}, 300_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  restoreSteadfast();
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`UPDATE "OrderItem" SET "costMovementId" = NULL WHERE "costMovementId" IS NOT NULL`);
    await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "variantId" IN (SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.kind = 'MATERIAL' AND p.name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest %'`);
  });
  await cleanupFixtures();
});

describe("booking fills the bottles still owed", () => {
  it("AF-1: an order of 2 owed bottles, booked → 2 filled: 12 ml oil and 2 bottles leave stock, nothing owed", async () => {
    const attar = await attarOf(oil);
    const order = await placeOrder([{ variantId: attar, quantity: 2 }]);
    expect(await stockOf(attar)).toBe(-2);
    const [oilBefore, bottleBefore] = [await stockOf(oil), await stockOf(bottle)];
    await bookOrderWithSteadfast(order.id);
    expect(await booked(order.id)).toBeTruthy();
    expect(await stockOf(attar)).toBe(0);
    expect(await stockOf(oil)).toBe(oilBefore - 12);
    expect(await stockOf(bottle)).toBe(bottleBefore - 2);
    expect(await failures(order.id)).toHaveLength(0);
    await assertInventoryInvariants(attar);
    expect(await booksMatch()).toEqual(MATCHED);
  });

  it("AF-2: a bottle already filled on the shelf is used first — 1 of 2 owed, so 1 is filled at booking", async () => {
    const attar = await attarOf(oil);
    const order = await placeOrder([{ variantId: attar, quantity: 2 }]);
    await recordFill({ variantId: attar, quantity: 1 }, OWNER, `af-prefill-${RUN}-${++key}`);
    expect(await stockOf(attar)).toBe(-1);
    const oilBefore = await stockOf(oil);
    await bookOrderWithSteadfast(order.id);
    expect(await stockOf(attar)).toBe(0);
    expect(await stockOf(oil)).toBe(oilBefore - 6);
  });

  it("AF-3: the oil is short → the booking stands, the bottle stays owed and waits on Today", async () => {
    const attar = await attarOf(dryOil, "UNLIMITED");
    const order = await placeOrder([{ variantId: attar, quantity: 1 }]);
    await bookOrderWithSteadfast(order.id);
    expect(await booked(order.id)).toBeTruthy();
    expect(await stockOf(attar)).toBe(-1);
    const f = await failures(order.id);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ variantId: attar, units: 1, resolvedAt: null });
    const today = await stockToday({ canSeeCost: true });
    expect(today.fillProblems).toEqual(expect.arrayContaining([expect.objectContaining({ variantId: attar, units: 1 })]));
  });

  it("AF-4: bulk booking of 3, one short → 2 filled, 1 waits, all 3 booked", async () => {
    const good = await attarOf(oil);
    const dry = await attarOf(dryOil, "UNLIMITED");
    const a = await placeOrder([{ variantId: good, quantity: 1 }]);
    const b = await placeOrder([{ variantId: dry, quantity: 1 }]);
    const c = await placeOrder([{ variantId: good, quantity: 1 }]);
    const r = await bookOrdersWithSteadfastBulk([a.id, b.id, c.id]);
    expect(r.booked).toHaveLength(3);
    expect(await stockOf(good)).toBe(0);
    expect(await stockOf(dry)).toBe(-1);
    expect(await failures(b.id)).toHaveLength(1);
    expect((await failures(a.id)).length + (await failures(c.id)).length).toBe(0);
    expect(await booksMatch()).toEqual(MATCHED);
  });

  it("AF-5: a cap order books with no fill and no failure", async () => {
    const order = await placeOrder([{ variantId: cap, quantity: 1 }]);
    const fills = await prisma.stockHubEntry.count({ where: { kind: "FILL" } });
    await bookOrderWithSteadfast(order.id);
    expect(await booked(order.id)).toBeTruthy();
    expect(await prisma.stockHubEntry.count({ where: { kind: "FILL" } })).toBe(fills);
    expect(await failures(order.id)).toHaveLength(0);
  });

  it("AF-6: once the waiting bottle is filled by hand, Today no longer shows the failure", async () => {
    const attar = await attarOf(dryOil, "UNLIMITED");
    const order = await placeOrder([{ variantId: attar, quantity: 1 }]);
    await bookOrderWithSteadfast(order.id);
    await buy(dryOil, 6, 5);
    await recordFill({ variantId: attar, quantity: 1 }, OWNER, `af-late-${RUN}-${++key}`);
    const today = await stockToday({ canSeeCost: true });
    expect(today.fillProblems.find((p) => p.variantId === attar)).toBeUndefined();
    // refused before writing, so filling by hand settles it; reading Today writes nothing
    expect((await failures(order.id))[0]).toMatchObject({ partial: false, resolvedAt: null });
  });

  it("AF-7: each booking has its own fill — a second consignment for the same order fills again", async () => {
    const attar = await attarOf(oil);
    const order = await placeOrder([{ variantId: attar, quantity: 1 }]);
    const plan = new Map([[order.id, [{ variantId: attar, units: 1 }]]]);
    await fillForBookedOrder(order.id, "C-1", plan);
    await fillForBookedOrder(order.id, "C-1", plan); // the same booking again: replayed, not filled twice
    expect(await stockOf(attar)).toBe(0);
    await fillForBookedOrder(order.id, "C-2", plan);
    expect(await stockOf(attar)).toBe(1);
  });

  it("AF-8: Try again records the waiting fill with its own key once the oil is in", async () => {
    const attar = await attarOf(dryOil, "UNLIMITED");
    const order = await placeOrder([{ variantId: attar, quantity: 1 }]);
    await bookOrderWithSteadfast(order.id);
    const [f] = await failures(order.id);
    await expect(retryAutoFill(f!.id, OWNER)).rejects.toMatchObject({ details: { code: "FILL_SHORT" } });
    await buy(dryOil, 6, 5);
    expect(await retryAutoFill(f!.id, OWNER)).toMatchObject({ resolved: true, replayed: false });
    expect(await stockOf(attar)).toBe(0);
    expect(await retryAutoFill(f!.id, OWNER)).toMatchObject({ resolved: true, replayed: true });
    expect(await booksMatch()).toEqual(MATCHED);
  });

  it("AF-9: a fill that stopped after writing stays on Today even once the size owes nothing", async () => {
    const attar = await attarOf(oil);
    const order = await placeOrder([{ variantId: attar, quantity: 1 }]);
    await recordFill({ variantId: attar, quantity: 1 }, OWNER, `af-partial-${RUN}-${++key}`);
    const row = await prisma.stockAutoFillFailure.create({ data: { orderId: order.id, variantId: attar, units: 1, reason: "stopped at receive the bottles", fillKey: `af-partial-row-${RUN}`, partial: true } });
    expect(await stockOf(attar)).toBe(0);
    const today = await stockToday({ canSeeCost: true });
    expect(today.fillProblems).toEqual(expect.arrayContaining([expect.objectContaining({ id: row.id, partial: true })]));
  });
});
