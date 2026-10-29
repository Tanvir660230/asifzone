import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, markOpeningPostedInTx, purgeFinanceTables, trackOrder, checkout } from "../../test-fixtures";
import { createOrder, deleteOrder, deriveOrderPricing, insertOrderRecord, receiveReturnedParcel, restoreOrder, updateOrderStatus } from "../../modules/orders/order.service";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { recordItemReturn } from "../../modules/orders/order-adjustments.service";
import { applyOrderModification } from "../../modules/orders/order-modification.service";
import { reviewReturnRequest } from "../../modules/return-requests/return-request.service";
import { adjustVariantStock, adjustVariantStockInTx, afterAdjustment, recordSale } from "../../modules/inventory/inventory.service";
import { loadOrderFacts } from "../metrics/facts.repository";
import { getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { activateInventoryCostingInTx, recordValuationInTx } from "./costing.service";
import { processFinancialEvent } from "./events.service";
import { projectOrder } from "./commerce-accounting.service";
import { runReconciliation } from "./reconciliation.service";
import type { FinanceActor } from "./finance-audit";

/** A manual increase as the stock hub's count makes it (adjustVariantStockInTx): the Adjust endpoint refuses increases once
 * costing is live (inventory recovery F-a), but the valuation of an increase is still what these tests pin down. */
const internalIncrease = async (variantId: string, delta: number, reason: "RESTOCK" | "ADJUSTMENT", adminId: string, note: string) => {
  const r = await prisma.$transaction((tx) => adjustVariantStockInTx(tx, variantId, delta, reason, adminId, note));
  afterAdjustment(r);
  return r.variant;
};

// Financial Core Phase 4B (docs/FINANCE_PHASE_4.md §9): inventory costing wired into the real commerce paths — checkout,
// oversell, order modification, exchange, cancellation, trash / restore, item returns, manual adjustments — against the
// real database. The central invariant everywhere: for every costed stock exit, the order line's unit cost = the exit's
// valuation unit cost (and Phase 3 COGS uses that same number). Variants are cut over before activation (what 4C will do).

const SYSTEM: FinanceActor = { type: "SYSTEM", label: "test" };
let admin: string;

type Pool = Record<string, { id: string; productId: string }>;
const pool: Pool = {};

async function lineOf(orderId: string) {
  return prisma.orderItem.findMany({ where: { orderId }, select: { id: true, variantId: true, quantity: true, unitCostSnapshot: true, unitCostSource: true, costMovementId: true }, orderBy: { id: "asc" } });
}
async function entriesOf(variantId: string) {
  return prisma.inventoryValuationEntry.findMany({ where: { variantId }, orderBy: { sequence: "asc" } });
}
async function stateOf(variantId: string) {
  const s = await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId } });
  return { valuedQty: s.valuedQty, value: Number(s.value), avg: s.avgUnitCost === null ? null : Number(s.avgUnitCost), unvaluedQty: s.unvaluedQty, deficitQty: s.deficitQty };
}
async function stockOf(variantId: string) {
  return (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { stock: true } })).stock;
}
/** Posts every waiting financial event through the Phase 1 engine (what the outbox consumer does). */
async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: "RECEIVED" }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function balance(key: string) {
  const { business } = await getFinanceContext();
  const m = await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key } } });
  const s = await prisma.journalLine.aggregate({ where: { accountId: m.accountId, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100;
}
async function deliver(orderId: string) {
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const) await updateOrderStatus(orderId, { status: s }, admin);
}
const order = async (variantId: string, quantity: number) => {
  const o = await createOrder(checkout([{ variantId, quantity }]));
  trackOrder(o.id);
  return o;
};
/** A gateway-paid order settling after stock ran out — the one path that may oversell (payment.service settlement). */
const paidOversell = async (variantId: string, quantity: number, quoted?: Awaited<ReturnType<typeof quote>>) => {
  const q = quoted ?? (await quote(variantId, quantity));
  const o = await insertOrderRecord(q.input, { ...q.pricing, customerId: null }, { status: "CONFIRMED" }, { allowOversell: true });
  trackOrder(o.id);
  return o;
};
/** The checkout quote, taken while stock was still there (a gateway order is paid against it and settles later). */
const quote = async (variantId: string, quantity: number) => {
  const input = checkout([{ variantId, quantity }]);
  return { input, pricing: await deriveOrderPricing(input, null) };
};

/** A product variant with `stock` units, created BEFORE costing is active (so it is outside costing until cut over). */
async function preActivationVariant(name: string, stock: number, opts: { catalogCost?: number | null; tracked?: boolean } = {}) {
  const p = await createStockedProduct({ stocks: [stock], basePrice: 1000 });
  if (opts.catalogCost !== undefined) await prisma.product.update({ where: { id: p.product.id }, data: { costPrice: opts.catalogCost } });
  if (opts.tracked === false) await prisma.product.update({ where: { id: p.product.id }, data: { trackInventory: false } });
  pool[name] = { id: p.variants[0]!.id, productId: p.product.id };
}

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(SYSTEM);
  await financeTransaction(async (tx) => {
    await tx.financeBusiness.update({ where: { id: ctx.business.id }, data: { openingDate: new Date("2026-01-01T00:00:00Z") } });
    await tx.financeAuditEntry.create({ data: { businessId: ctx.business.id, actorType: "SYSTEM", actorLabel: "test", action: "business.update", entityType: "FinanceBusiness", entityId: ctx.business.id } });
    await markOpeningPostedInTx(tx, ctx.business.id, new Date("2026-01-01T00:00:00Z"));
  });
  // The pool: variants as they exist before 4C cuts them over.
  for (const [name, stock] of [["A", 100], ["B", 5], ["C", 2], ["D", 10], ["E", 20], ["E2", 10], ["F", 10], ["G", 10], ["H", 10], ["I", 10], ["J", 10], ["K", 3], ["M1", 50], ["M2", 50], ["R", 40], ["X1", 10], ["X2", 10], ["P", 10]] as const) await preActivationVariant(name, stock, { catalogCost: 999 });
  await preActivationVariant("U", 0, { catalogCost: 300, tracked: false });
  await preActivationVariant("U0", 0, { catalogCost: null, tracked: false });
  await preActivationVariant("N", 10, { catalogCost: 200 });
  // A legacy order on D, placed at its catalog cost (150.00) before costing exists.
  await prisma.product.update({ where: { id: pool.D!.productId }, data: { costPrice: 150 } });
  const legacy = await placeOrder([{ variantId: pool.D!.id, quantity: 2 }]);
  pool.legacyOrder = { id: legacy.id, productId: "" };
  // The cutover 4C will perform: each variant's first valuation = its physical stock at a recorded cost (N is not cut over).
  const cost: Record<string, number> = { A: 12_000, F: 10_000, G: 20_000 };
  await financeTransaction(async (tx) => {
    for (const name of ["A", "B", "C", "D", "E", "E2", "F", "G", "H", "I", "J", "K", "M1", "M2", "R", "X1", "X2", "P"]) {
      const v = pool[name]!.id;
      const qty = (await tx.productVariant.findUniqueOrThrow({ where: { id: v } })).stock;
      await recordValuationInTx(tx, { business: ctx.business, brandId: ctx.brand.id, variantId: v, sourceType: "Cutover", sourceId: "test", financialDate: "2026-10-15", op: { type: "CUTOVER", qty, valueMinor: qty * (cost[name] ?? 10_000) } });
    }
    await activateInventoryCostingInTx(tx, ctx.business.id, new Date(), SYSTEM);
  });
});

afterAll(async () => {
  await purgeFinanceTables(); // the valuation ledger first: it protects the variants and movements from deletion
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`UPDATE "OrderItem" SET "costMovementId" = NULL WHERE "costMovementId" IS NOT NULL`);
  });
  await cleanupFixtures();
});

describe("cost determined at the stock exit", () => {
  it("checkout: the line, the valuation entry and Phase 3 / dashboard COGS are one number", async () => {
    const o = await order(pool.A!.id, 3);
    const [line] = await lineOf(o.id);
    expect(line).toMatchObject({ unitCostSnapshot: 12_000, unitCostSource: "INVENTORY" });
    const entry = await prisma.inventoryValuationEntry.findUniqueOrThrow({ where: { stockMovementId: line!.costMovementId! } });
    expect(entry).toMatchObject({ kind: "OUTFLOW", qtyChange: -3, unitCostMinor: 12_000, costBasis: "SNAPSHOT", valuationStatus: "KNOWN" });
    expect([Number(entry.valueChange), Number(entry.bookValue), Number(entry.costAdjustment)]).toEqual([-360, -360, 0]);
    expect(await stateOf(pool.A!.id)).toMatchObject({ valuedQty: 97, value: 11_640, avg: 120 });
    expect(await prisma.financialEvent.count({ where: { eventKey: `valuation:${entry.id}` } })).toBe(0); // nothing to adjust
    const [fact] = await loadOrderFacts([o.id], "BDT");
    expect(fact!.lines[0]!.unitCostSnapshot).toBe(12_000); // the dashboard reads the same cost
    const cogsBefore = await balance("cogs.goods");
    await deliver(o.id);
    await projectOrder(o.id);
    expect(Math.round((await balance("cogs.goods")) * 100 - cogsBefore * 100)).toBe(36_000); // Phase 3 books 3 × 120.00
  });

  it("the database refuses any divergence between a line and its stock exit", async () => {
    const o = await order(pool.A!.id, 1);
    const [line] = await lineOf(o.id);
    await expect(prisma.orderItem.update({ where: { id: line!.id }, data: { unitCostSnapshot: 1 } })).rejects.toThrow(/never changes/);
    await expect(prisma.orderItem.update({ where: { id: line!.id }, data: { costMovementId: null } })).rejects.toThrow(/stays linked/);
    // A different order's line can't borrow this exit, and a forged line can't claim another cost.
    const other = await order(pool.A!.id, 1);
    const [otherLine] = await lineOf(other.id);
    await expect(prisma.orderItem.create({ data: { orderId: o.id, variantId: pool.A!.id, productNameSnapshot: "x", skuSnapshot: "x", sizeSnapshot: "x", colorSnapshot: "x", priceSnapshot: 1, quantity: 1, unitCostSnapshot: 11_111, unitCostSource: "INVENTORY", costMovementId: line!.costMovementId } })).rejects.toThrow(/differs from the valuation/);
    await expect(prisma.orderItem.create({ data: { orderId: o.id, variantId: pool.A!.id, productNameSnapshot: "x", skuSnapshot: "x", sizeSnapshot: "x", colorSnapshot: "x", priceSnapshot: 1, quantity: 1, unitCostSnapshot: 12_000, unitCostSource: "INVENTORY", costMovementId: otherLine!.costMovementId } })).rejects.toThrow(/differs from the valuation/);
    await expect(prisma.orderItem.create({ data: { orderId: o.id, variantId: pool.A!.id, productNameSnapshot: "x", skuSnapshot: "x", sizeSnapshot: "x", colorSnapshot: "x", priceSnapshot: 1, quantity: 1, unitCostSnapshot: 12_000, unitCostSource: "CATALOG", costMovementId: line!.costMovementId } })).rejects.toThrow(/catalog_cost_unlinked|differs/);
  });

  it("an exit of a costed variant without a determined cost is refused — and nothing is left half-written", async () => {
    const before = { stock: await stockOf(pool.J!.id), entries: (await entriesOf(pool.J!.id)).length, movements: await prisma.stockMovement.count({ where: { variantId: pool.J!.id } }) };
    const o = await placeOrder([{ variantId: pool.N!.id, quantity: 1 }]); // any order id to hang the exit on
    // A costed exit must name the order lines that take its cost — otherwise it is refused (nothing commits uncosted).
    await expect(prisma.$transaction((tx) => recordSale(tx, o.id, [{ variantId: pool.J!.id, quantity: 1 }]))).rejects.toThrow(/COSTING_EXIT_UNLINKED/);
    // A failure after a costed exit rolls the line's cost, the stock, the movement and the valuation back together.
    let lineId = "";
    await expect(prisma.$transaction(async (tx) => {
      const line = await tx.orderItem.create({ data: { orderId: o.id, variantId: pool.J!.id, productNameSnapshot: "J", skuSnapshot: "J", sizeSnapshot: "M", colorSnapshot: "Black", priceSnapshot: 1000, quantity: 2, unitCostSnapshot: 99_900, unitCostSource: "CATALOG" } });
      lineId = line.id;
      await recordSale(tx, o.id, [{ variantId: pool.J!.id, quantity: 2, orderItemIds: [line.id] }]);
      const costed = await tx.orderItem.findUniqueOrThrow({ where: { id: line.id }, select: { unitCostSnapshot: true, unitCostSource: true, costMovementId: true } });
      expect(costed).toMatchObject({ unitCostSnapshot: 10_000, unitCostSource: "INVENTORY" }); // the exit replaced the catalog cost
      throw new Error("later step failed");
    })).rejects.toThrow("later step failed");
    expect(await prisma.orderItem.count({ where: { id: lineId } })).toBe(0);
    expect({ stock: await stockOf(pool.J!.id), entries: (await entriesOf(pool.J!.id)).length, movements: await prisma.stockMovement.count({ where: { variantId: pool.J!.id } }) }).toEqual(before);
  });
});

describe("concurrency", () => {
  it("parallel checkouts of the last units: stock and valuation stay in step, every line = its exit", async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => order(pool.B!.id, 1)));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(5);
    expect(results.filter((r) => r.status === "rejected").every((r) => /stock/i.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
    expect(await stockOf(pool.B!.id)).toBe(0);
    expect(await stateOf(pool.B!.id)).toMatchObject({ valuedQty: 0, value: 0, deficitQty: 0 });
    const lines = await prisma.orderItem.findMany({ where: { variantId: pool.B!.id }, select: { unitCostSnapshot: true, unitCostSource: true, costMovementId: true } });
    expect(lines).toHaveLength(5);
    expect(lines.every((l) => l.unitCostSnapshot === 10_000 && l.unitCostSource === "INVENTORY" && l.costMovementId)).toBe(true);
    expect((await entriesOf(pool.B!.id)).filter((e) => e.kind === "OUTFLOW")).toHaveLength(5);
  });

  it("parallel paid oversells: the first units are inventory-costed, the rest provisional — deficit, 5150 and stock all exact", async () => {
    const before = { inv: await balance("asset.inventory"), adj: await balance("cogs.cost_adjustments") };
    const results = await Promise.all(Array.from({ length: 6 }, () => paidOversell(pool.C!.id, 1)));
    expect(results).toHaveLength(6);
    expect(await stockOf(pool.C!.id)).toBe(-4);
    const sources = (await prisma.orderItem.findMany({ where: { variantId: pool.C!.id }, select: { unitCostSource: true, unitCostSnapshot: true } }));
    expect(sources.filter((s) => s.unitCostSource === "INVENTORY")).toHaveLength(2);
    expect(sources.filter((s) => s.unitCostSource === "INVENTORY_PROVISIONAL")).toHaveLength(4);
    expect(sources.every((s) => s.unitCostSnapshot === 10_000)).toBe(true); // the last average is the explicit provisional cost
    expect(await stateOf(pool.C!.id)).toMatchObject({ valuedQty: 0, deficitQty: 4, avg: 100 });
    await postPending();
    // Units issued short are booked by Phase 3 at recognition; until their cost is known the provisional value is held
    // against 5150 so the inventory account equals the valuation now.
    expect(Math.round(((await balance("asset.inventory")) - before.inv) * 100)).toBe(40_000);
    expect(Math.round(((await balance("cogs.cost_adjustments")) - before.adj) * 100)).toBe(-40_000);
    // Stock comes back (a manual restock — receipts arrive in 4D): it covers the deficit first; the provisional cost and
    // the cost of the covering units net to zero in 5150 here (same cost) — no journal was rewritten.
    await internalIncrease(pool.C!.id, 4, "RESTOCK", admin, "found in the back room");
    await postPending();
    expect(await stockOf(pool.C!.id)).toBe(0);
    expect(await stateOf(pool.C!.id)).toMatchObject({ valuedQty: 0, deficitQty: 0 });
    expect(Math.round(((await balance("cogs.cost_adjustments")) - before.adj) * 100)).toBe(0);
  });
});

describe("contention and rollback", () => {
  it("concurrent orders over two SKUs at once: every line = its exit, both positions exact", async () => {
    const orders = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const o = await createOrder(checkout([{ variantId: pool.M1!.id, quantity: 1 + (i % 2) }, { variantId: pool.M2!.id, quantity: 2 }]));
      trackOrder(o.id);
      return o;
    }));
    const lines = await prisma.orderItem.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, select: { variantId: true, quantity: true, unitCostSnapshot: true, unitCostSource: true, costMovementId: true } });
    expect(lines).toHaveLength(16);
    for (const l of lines) {
      const e = await prisma.inventoryValuationEntry.findUniqueOrThrow({ where: { stockMovementId: l.costMovementId! } });
      expect([e.unitCostMinor, -e.qtyChange]).toEqual([l.unitCostSnapshot, l.quantity]);
    }
    expect(await stockOf(pool.M1!.id)).toBe(50 - 12);
    expect(await stockOf(pool.M2!.id)).toBe(50 - 16);
    expect(await stateOf(pool.M1!.id)).toMatchObject({ valuedQty: 38, value: 3_800 });
    expect(await stateOf(pool.M2!.id)).toMatchObject({ valuedQty: 34, value: 3_400 });
  });

  it("returns racing new orders on one SKU stay exact (each return at its own line's cost)", async () => {
    // Distinct customers: this test isolates what costing adds to stock contention. One customer's checkout racing their own
    // store-credit return is covered by modules/orders/same-customer-race.integration.test.ts (FINANCE_PHASE_4 §9.8, fixed).
    const R = pool.R!.id;
    let phone = 0;
    const own = async (quantity: number) => {
      const o = await createOrder(checkout([{ variantId: R, quantity }], { customerPhone: `0181${String(Date.now()).slice(-4)}${String(++phone).padStart(3, "0")}` }));
      trackOrder(o.id);
      return o;
    };
    const first = await Promise.all(Array.from({ length: 4 }, () => own(2)));
    for (const o of first) await deliver(o.id);
    const lines = await Promise.all(first.map(async (o) => (await lineOf(o.id))[0]!));
    await Promise.all([
      ...first.map((o, i) => recordItemReturn(o.id, { items: [{ orderItemId: lines[i]!.id, quantity: 1, restock: true }], reason: "size", compensation: "STORE_CREDIT" }, admin, `p4b-race-${o.id}`)),
      ...Array.from({ length: 4 }, () => own(1)),
    ]);
    expect(await stockOf(R)).toBe(40 - 8 - 4); // the 4 returns wait for their parcels (owner decision M2)
    expect(await stateOf(R)).toMatchObject({ valuedQty: 28, value: 2_800, deficitQty: 0 });
    for (const o of first) await receiveReturnedParcel(o.id, admin, {});
    expect(await stockOf(R)).toBe(40 - 8 + 4 - 4);
    expect(await stateOf(R)).toMatchObject({ valuedQty: 32, value: 3_200, deficitQty: 0 });
    const r = await runReconciliation({ checks: ["inventory.quantity_vs_valuation", "inventory.order_cost_links"] }, SYSTEM);
    expect(r.results.map((x) => x.status)).toEqual(["MATCHED", "MATCHED"]);
  });

  it("a failure inside the one-call persistence (lines that don't match the exit) leaves nothing behind", async () => {
    const X1 = pool.X1!.id;
    const before = { stock: await stockOf(X1), entries: (await entriesOf(X1)).length, state: await stateOf(X1) };
    const o = await placeOrder([{ variantId: pool.N!.id, quantity: 1 }]);
    await expect(prisma.$transaction(async (tx) => {
      // The exit names a line of ANOTHER variant: the persistence refuses (0 of 1 lines took the cost) — all rolled back.
      const other = await tx.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
      await recordSale(tx, o.id, [{ variantId: X1, quantity: 2, orderItemIds: [other.id] }]);
    })).rejects.toThrow(/COSTING_EXIT_LINES/);
    expect({ stock: await stockOf(X1), entries: (await entriesOf(X1)).length, state: await stateOf(X1) }).toEqual(before);
    expect(await prisma.stockMovement.count({ where: { orderId: o.id, variantId: X1 } })).toBe(0);
  });

  it("a multi-SKU exit failing on its second SKU rolls back the first SKU's valuation and line cost too", async () => {
    const [X1, X2] = [pool.X1!.id, pool.X2!.id];
    const before = { s1: await stockOf(X1), s2: await stockOf(X2), e1: (await entriesOf(X1)).length, e2: (await entriesOf(X2)).length };
    const o = await placeOrder([{ variantId: pool.N!.id, quantity: 1 }]);
    let lineId = "";
    await expect(prisma.$transaction(async (tx) => {
      const line = await tx.orderItem.create({ data: { orderId: o.id, variantId: X1, productNameSnapshot: "x", skuSnapshot: "x", sizeSnapshot: "M", colorSnapshot: "Black", priceSnapshot: 1, quantity: 1, unitCostSnapshot: 1, unitCostSource: "CATALOG" } });
      lineId = line.id;
      await recordSale(tx, o.id, [{ variantId: X1, quantity: 1, orderItemIds: [line.id] }, { variantId: X2, quantity: 1 }]); // X2 has no lines
    })).rejects.toThrow(/COSTING_EXIT_UNLINKED/);
    expect({ s1: await stockOf(X1), s2: await stockOf(X2), e1: (await entriesOf(X1)).length, e2: (await entriesOf(X2)).length }).toEqual(before);
    expect(await prisma.orderItem.count({ where: { id: lineId } })).toBe(0);
  });
});

describe("what is not inventory-costed", () => {
  it("untracked products keep the catalog cost, labelled CATALOG — no valuation, no negative inventory", async () => {
    const u = await order(pool.U!.id, 2);
    expect((await lineOf(u.id))[0]).toMatchObject({ unitCostSnapshot: 30_000, unitCostSource: "CATALOG", costMovementId: null });
    const u0 = await order(pool.U0!.id, 1);
    expect((await lineOf(u0.id))[0]).toMatchObject({ unitCostSnapshot: null, unitCostSource: "NONE", costMovementId: null });
    expect(await prisma.inventoryValuationEntry.count({ where: { variantId: { in: [pool.U!.id, pool.U0!.id] } } })).toBe(0);
    expect(await prisma.inventoryCostState.count({ where: { variantId: { in: [pool.U!.id, pool.U0!.id] } } })).toBe(0);
  });

  it("a variant not yet cut over stays outside costing (catalog cost, CATALOG) until 4C values it", async () => {
    const o = await order(pool.N!.id, 1);
    expect((await lineOf(o.id))[0]).toMatchObject({ unitCostSnapshot: 20_000, unitCostSource: "CATALOG", costMovementId: null });
    expect(await prisma.inventoryValuationEntry.count({ where: { variantId: pool.N!.id } })).toBe(0);
  });

  it("a variant created after activation enters costing with its first movement — its stock has no cost: never zero, never the catalog", async () => {
    const p = await createStockedProduct({ stocks: [4], basePrice: 900 });
    const v = p.variants[0]!;
    await prisma.productVariant.update({ where: { id: v.id }, data: { costPrice: 50 } });
    expect(await stateOf(v.id)).toMatchObject({ valuedQty: 0, unvaluedQty: 4, avg: null });
    expect((await entriesOf(v.id))[0]).toMatchObject({ kind: "INFLOW", valuationStatus: "MISSING", unvaluedQtyChange: 4 });
    const o = await order(v.id, 1);
    expect((await lineOf(o.id))[0]).toMatchObject({ unitCostSnapshot: null, unitCostSource: "NONE" }); // not 5000 (catalog), not 0
    expect((await lineOf(o.id))[0]!.costMovementId).not.toBeNull();
    expect(await stateOf(v.id)).toMatchObject({ unvaluedQty: 3 });
  });
});

describe("units coming back keep the cost they left at", () => {
  it("returns re-enter at the line's own cost (not today's average); damaged units leave at it again; cancellation likewise", async () => {
    const D = pool.D!.id;
    const o = await order(D, 2); // at 100.00
    // The legacy order (150.00, placed before costing) is cancelled: its units come back at 150.00 — the average moves.
    await updateOrderStatus(pool.legacyOrder!.id, { status: "CANCELLED" }, admin);
    // Cut over 8 @ 100.00 (800) − this order's 2 @ 100.00 + the legacy 2 back @ 150.00 = 8 units, 900.00, average 112.50.
    expect(await stateOf(D)).toMatchObject({ valuedQty: 8, value: 900, avg: 112.5 });
    await deliver(o.id);
    await projectOrder(o.id);
    const [line] = await lineOf(o.id);
    await recordItemReturn(o.id, { items: [{ orderItemId: line!.id, quantity: 1, restock: true }], reason: "size", compensation: "STORE_CREDIT" }, admin, `p4b-ret1-${o.id}`);
    await recordItemReturn(o.id, { items: [{ orderItemId: line!.id, quantity: 1, restock: true }], reason: "torn", compensation: "STORE_CREDIT" }, admin, `p4b-ret2-${o.id}`);
    // Both come back; one is torn — written off at receipt (owner decision M2).
    await receiveReturnedParcel(o.id, admin, { lines: [{ orderItemId: line!.id, quantity: 2, damaged: 1 }] });
    const entries = await entriesOf(D);
    const returns = entries.filter((e) => e.note?.startsWith("RETURN"));
    expect(returns.map((e) => [e.unitCostMinor, e.qtyChange])).toEqual([[10_000, 2]]); // one parcel, both units, at the line's cost
    const damaged = entries.filter((e) => e.note?.startsWith("DAMAGED"));
    expect(damaged.map((e) => [e.unitCostMinor, e.qtyChange])).toEqual([[10_000, -1]]);
    const cancel = entries.find((e) => e.note?.startsWith("CANCELLATION"))!;
    expect(cancel.unitCostMinor).toBe(15_000);
    await projectOrder(o.id);
    await postPending();
  });

  it("a parcel received back: good units return at the line's cost, damaged and lost ones are booked to shrinkage at it", async () => {
    const P = pool.P!.id;
    const o = await order(P, 3); // at 100.00
    for (const s of ["CONFIRMED", "SHIPPED", "CANCELLED"] as const) await updateOrderStatus(o.id, { status: s }, admin);
    await projectOrder(o.id);
    await postPending();
    const before = { inv: await balance("asset.inventory"), shrink: await balance("cogs.inventory_shrinkage") };
    const [line] = await lineOf(o.id);
    await receiveReturnedParcel(o.id, admin, { lines: [{ orderItemId: line!.id, quantity: 2, damaged: 1, lost: 1 }] });
    await projectOrder(o.id);
    await postPending();
    expect(await stockOf(P)).toBe(8);
    expect(await stateOf(P)).toMatchObject({ valuedQty: 8, value: 800 });
    const out = (await entriesOf(P)).filter((e) => e.note?.startsWith("DAMAGED") || e.note?.startsWith("LOST"));
    expect(out.map((e) => [e.qtyChange, e.unitCostMinor])).toEqual([[-1, 10_000], [-1, 10_000]]);
    // The parcel never left the books (a cancelled COD sale is never recognised): only the two written-off units move them.
    expect(Math.round(((await balance("cogs.inventory_shrinkage")) - before.shrink) * 100)).toBe(20_000);
    expect(Math.round(((await balance("asset.inventory")) - before.inv) * 100)).toBe(-20_000);
  });

  it("trash and restore: the restore re-takes the units at the line's own cost; the line stays linked to its first exit", async () => {
    const H = pool.H!.id;
    const o = await order(H, 2);
    const [before] = await lineOf(o.id);
    await deleteOrder(o.id, admin);
    await restoreOrder(o.id, admin);
    const [after] = await lineOf(o.id);
    expect(after).toMatchObject({ unitCostSnapshot: before!.unitCostSnapshot, costMovementId: before!.costMovementId });
    const e = await entriesOf(H);
    expect(e.slice(-2).map((x) => [x.qtyChange, x.unitCostMinor])).toEqual([[2, 10_000], [-2, 10_000]]);
    expect(await stockOf(H)).toBe(8);
    expect(await stateOf(H)).toMatchObject({ valuedQty: 8, value: 800 });
  });
});

describe("order modification and exchange", () => {
  it("added units are a new line with its own exit and cost; removed units come back at their line's cost", async () => {
    const E = pool.E!.id;
    const E2 = pool.E2!.id;
    const o = await order(E, 3);
    const actor = { type: "ADMIN" as const, adminId: admin };
    await applyOrderModification(o.id, { items: [{ variantId: E, quantity: 5 }, { variantId: E2, quantity: 1 }] }, actor);
    const lines = await lineOf(o.id);
    const eLines = lines.filter((l) => l.variantId === E);
    expect(eLines).toHaveLength(2); // the original 3 and the 2 added — never one line with two costs
    expect(new Set(eLines.map((l) => l.costMovementId)).size).toBe(2);
    expect(eLines.every((l) => l.unitCostSource === "INVENTORY" && l.unitCostSnapshot === 10_000)).toBe(true);
    expect(lines.find((l) => l.variantId === E2)).toMatchObject({ unitCostSource: "INVENTORY", unitCostSnapshot: 10_000 });
    expect(await stockOf(E)).toBe(15);
    await applyOrderModification(o.id, { items: [{ variantId: E, quantity: 1 }] }, actor);
    expect(await stockOf(E)).toBe(19);
    expect(await stockOf(E2)).toBe(10);
    const back = (await entriesOf(E)).filter((x) => x.note?.startsWith("CANCELLATION"));
    expect(back.map((x) => [x.qtyChange, x.unitCostMinor, Number(x.valueChange)])).toEqual([[4, 10_000, 400]]);
    expect(await stateOf(E)).toMatchObject({ valuedQty: 19, value: 1_900 });
  });

  it("an exchange replacement is its own stock exit at its own cost — the original's cost is not reused", async () => {
    const original = await order(pool.F!.id, 1);
    await deliver(original.id);
    const [ol] = await lineOf(original.id);
    const req = await prisma.returnRequest.create({ data: { orderId: original.id, customerId: original.customerId!, reason: "Size", type: "EXCHANGE", orderItemId: ol!.id, requestedVariantId: pool.G!.id } });
    await reviewReturnRequest(req.id, { status: "APPROVED" }, admin);
    const replacementId = (await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).exchangeOrderId!;
    trackOrder(replacementId);
    await receiveReturnedParcel(original.id, admin, {}); // the original goes back into stock when it arrives
    const [rl] = await lineOf(replacementId);
    expect(rl).toMatchObject({ variantId: pool.G!.id, unitCostSnapshot: 20_000, unitCostSource: "INVENTORY" });
    expect((await prisma.inventoryValuationEntry.findUniqueOrThrow({ where: { stockMovementId: rl!.costMovementId! } })).unitCostMinor).toBe(20_000);
    const back = (await entriesOf(pool.F!.id)).filter((x) => x.note?.startsWith("RETURN"));
    expect(back.map((x) => x.unitCostMinor)).toEqual([10_000]);
  });
});

describe("manual stock adjustments", () => {
  it("are valued at the running average and booked against shrinkage / count adjustments — never as a purchase", async () => {
    const I = pool.I!.id;
    const before = { inv: await balance("asset.inventory"), shrink: await balance("cogs.inventory_shrinkage"), count: await balance("cogs.count_adjustments"), grni: await balance("liability.grni") };
    await adjustVariantStock(I, -2, "DAMAGED", admin, "water damage");
    await internalIncrease(I, 3, "RESTOCK", admin, "found during count");
    await postPending();
    const entries = (await entriesOf(I)).slice(-2);
    expect(entries.map((e) => [e.kind, e.costBasis, e.valuationStatus, Number(e.valueChange)])).toEqual([["OUTFLOW", "AVERAGE", "KNOWN", -200], ["INFLOW", "AVERAGE", "ESTIMATED", 300]]);
    expect(Math.round(((await balance("cogs.inventory_shrinkage")) - before.shrink) * 100)).toBe(20_000);
    expect(Math.round(((await balance("cogs.count_adjustments")) - before.count) * 100)).toBe(-30_000);
    expect(Math.round(((await balance("asset.inventory")) - before.inv) * 100)).toBe(10_000);
    expect(await balance("liability.grni")).toBe(before.grni); // not a supplier purchase
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { variantId: I, reason: "RESTOCK" }, orderBy: { createdAt: "desc" } });
    expect(movement).toMatchObject({ note: "found during count", adminId: admin });
  });

  it("an increase with no cost ever known is held unvalued and books nothing", async () => {
    const p = await createStockedProduct({ stocks: [0], basePrice: 700 });
    const v = p.variants[0]!.id;
    const events = await prisma.financialEvent.count();
    await internalIncrease(v, 5, "RESTOCK", admin, "opening count");
    expect(await stateOf(v)).toMatchObject({ unvaluedQty: 5, valuedQty: 0, avg: null });
    expect(await prisma.financialEvent.count()).toBe(events);
  });
});

describe("the books and the valuation converge", () => {
  it("over a full cycle (sales, oversell, cover, delivery, recognition), Δ inventory account = Σ valuation change", async () => {
    const K = pool.K!.id;
    const cut = (await entriesOf(K))[0]!;
    const quotedB = await quote(K, 2);
    const a = await order(K, 2);
    const b = await paidOversell(K, 2, quotedB); // settles after stock ran out: 1 unit short
    await internalIncrease(K, 1, "RESTOCK", admin, "cover the shortfall");
    for (const o of [a, b]) {
      await deliver(o.id);
      await projectOrder(o.id);
    }
    await postPending();
    const entries = (await entriesOf(K)).filter((e) => e.id !== cut.id);
    const valuation = Math.round(entries.reduce((s, e) => s + Number(e.valueChange), 0) * 100);
    const orderLines = await prisma.journalLine.aggregate({ where: { partyId: { in: [a.id, b.id] }, account: { code: "1610" }, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
    const keys = entries.map((e) => `valuation:${e.id}`);
    const valued = await prisma.journalLine.aggregate({ where: { account: { code: "1610" }, entry: { status: "POSTED", financialEvent: { eventKey: { in: keys } } } }, _sum: { debit: true, credit: true } });
    const ledger = Math.round((Number(orderLines._sum.debit ?? 0) - Number(orderLines._sum.credit ?? 0) + Number(valued._sum.debit ?? 0) - Number(valued._sum.credit ?? 0)) * 100);
    expect(ledger).toBe(valuation);
    expect(await stockOf(K)).toBe(0);
    expect(await stateOf(K)).toMatchObject({ valuedQty: 0, deficitQty: 0, unvaluedQty: 0 });
  });

  it("every inventory check matches; Phase 3's checks still match; events post exactly once", async () => {
    await postPending();
    const r = await runReconciliation({ checks: ["inventory.order_cost_links", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "commerce.duplicates", "ledger.integrity", "events.unposted"] }, SYSTEM);
    const byKey = Object.fromEntries(r.results.map((x) => [x.checkKey, x]));
    for (const k of Object.keys(byKey)) expect(byKey[k], `${k}: ${JSON.stringify(byKey[k]!.details)}`).toMatchObject({ status: "MATCHED" });
    expect((byKey["inventory.order_cost_links"]!.details as { linesByCostSource: Record<string, number> }).linesByCostSource).toMatchObject({ CATALOG: expect.any(Number), INVENTORY: expect.any(Number), INVENTORY_PROVISIONAL: expect.any(Number), NONE: expect.any(Number) });
    const posted = await prisma.financialEvent.findFirstOrThrow({ where: { eventType: "inventory.valued", status: "POSTED" } });
    expect(await processFinancialEvent(posted.id)).toBe("already_posted");
    const anyMovement = await prisma.inventoryValuationEntry.findFirstOrThrow({ where: { stockMovementId: { not: null } } });
    const ctx = await getFinanceContext();
    await expect(financeTransaction((tx) => recordValuationInTx(tx, { business: ctx.business, brandId: ctx.brand.id, variantId: anyMovement.variantId, stockMovementId: anyMovement.stockMovementId, sourceType: "Test", sourceId: "dup", financialDate: "2026-10-15", op: { type: "INFLOW", qty: 1, valueMinor: 1, basis: "MANUAL" } }))).rejects.toThrow(/23505|already exists/); // the unique index: one valuation per movement
  });

  it("historical lines are untouched: the legacy order keeps its catalog cost; costing is a one-way switch", async () => {
    const [legacy] = await lineOf(pool.legacyOrder!.id);
    expect(legacy).toMatchObject({ unitCostSnapshot: 15_000, unitCostSource: "CATALOG", costMovementId: null });
    const ctx = await getFinanceContext();
    await expect(prisma.financeBusiness.update({ where: { id: ctx.business.id }, data: { inventoryCostingActivatedAt: null } })).rejects.toThrow(/stays active/);
  });
});
