import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { businessDate, PERMISSIONS } from "@clothing-brand/shared";
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
import { reverseJournal } from "../finance/journal.service";
import { financeAlerts } from "../finance/finance-alerts.service";
import { profitByDay } from "../finance/profit.service";
import { adjustVariantStockInTx, afterAdjustment, reverseStockMovement } from "../../modules/inventory/inventory.service";
import { recordCounts } from "./count.service";

// Stock correction (docs/STOCK_HUB.md §10): a mistaken hand-made entry is undone exactly — the units and, in the books, the
// very amount it booked — not counted away at today's average. The figures follow the 24 Oct attar case: 2 caps at ৳587,
// then a mistaken +200 restock booked at the average as a ৳1,17,400 gain to 5210.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor & { type: "ADMIN" };
let owner = "";
let a = ""; // 2 at ৳587 (valued)
let b = ""; // nothing, never costed
const as = (r: request.Test) => r.set("Cookie", [`access_token=${signAccessToken({ adminId: owner, role: "OWNER" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);

const net5210 = async () => Number((await prisma.$queryRaw<Array<{ n: string | null }>>`
  SELECT SUM(l.credit - l.debit)::text AS n FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "LedgerAccount" acc ON acc.id = l."accountId"
  WHERE acc.code = '5210' AND e.status = 'POSTED'`)[0]?.n ?? 0);
async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function checks() {
  await postPending();
  const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity"] }, OWNER);
  return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
}
const MATCHED = { "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "ledger.integrity": "MATCHED" };
async function restock(variantId: string, qty: number) {
  const r = await prisma.$transaction((tx) => adjustVariantStockInTx(tx, variantId, qty, "RESTOCK", owner, "mistaken entry"));
  afterAdjustment(r);
  return prisma.stockMovement.findFirstOrThrow({ where: { variantId, reason: "RESTOCK" }, orderBy: { createdAt: "desc" } });
}

beforeAll(async () => {
  await purgeFinanceTables();
  owner = await ownerId();
  OWNER = { type: "ADMIN", adminId: owner, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const p = await createStockedProduct({ stocks: [2, 0], basePrice: 1450 });
  [a, b] = [p.variants[0]!.id, p.variants[1]!.id];
  await saveOpeningInventory([{ variantId: a, sku: a, name: a, quantity: 2, unitCost: 587, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
}, 120_000);

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("reversing a mistaken entry exactly", () => {
  it("a +200 restock booked at the average (a ৳1,17,400 gain) is undone to the paisa — units, valuation and 5210", async () => {
    const before = await net5210();
    const mistake = await restock(a, 200);
    await postPending();
    expect(await net5210()).toBeCloseTo(before + 117_400, 2);
    const r = await reverseStockMovement(mistake.id, { reason: "typed by mistake" }, OWNER);
    expect(r.stock).toBe(2);
    expect(r.movement).toMatchObject({ change: -200, reason: "RESTOCK", reversesMovementId: mistake.id });
    await postPending();
    expect(await net5210()).toBeCloseTo(before, 2);
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: a } })).toMatchObject({ valuedQty: 2, unvaluedQty: 0, deficitQty: 0 });
    expect(Number((await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: a } })).value)).toBe(1174);
    expect(await checks()).toEqual(MATCHED);
    await assertInventoryInvariants(a);
  });

  it("once only: the entry can't be reversed twice, and a correction is never itself reversed", async () => {
    const original = await prisma.stockMovement.findFirstOrThrow({ where: { variantId: a, reason: "RESTOCK", change: 200 } });
    await expect(reverseStockMovement(original.id, { reason: "again" }, OWNER)).rejects.toMatchObject({ statusCode: 409, details: { code: "ALREADY_REVERSED" } });
    const correction = await prisma.stockMovement.findFirstOrThrow({ where: { reversesMovementId: original.id } });
    await expect(reverseStockMovement(correction.id, { reason: "undo the undo" }, OWNER)).rejects.toMatchObject({ details: { code: "REVERSAL_OF_REVERSAL" } });
  });

  it("an entry with no value (an item never costed) comes back out with nothing booked", async () => {
    const before = await net5210();
    const m = await restock(b, 5);
    expect((await prisma.inventoryValuationEntry.findUniqueOrThrow({ where: { stockMovementId: m.id } })).valuationStatus).toBe("MISSING");
    await reverseStockMovement(m.id, { reason: "never arrived" }, OWNER);
    await postPending();
    expect(await stockOf(b)).toBe(0);
    expect(await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: b } })).toMatchObject({ valuedQty: 0, unvaluedQty: 0, deficitQty: 0 });
    expect(await net5210()).toBeCloseTo(before, 2);
    expect(await checks()).toEqual(MATCHED);
  });

  it("refused when the units were sold since (count the item instead), and for an order's movement", async () => {
    const m = await restock(a, 3); // a: 5
    await placeOrder([{ variantId: a, quantity: 4 }], { customerPhone: "01712000081" }); // a: 1
    await expect(reverseStockMovement(m.id, { reason: "typed by mistake" }, OWNER)).rejects.toMatchObject({ statusCode: 409, details: { code: "NOT_ENOUGH_LEFT" } });
    expect(await stockOf(a)).toBe(1);
    const sale = await prisma.stockMovement.findFirstOrThrow({ where: { variantId: a, reason: "ORDER" } });
    await expect(reverseStockMovement(sale.id, { reason: "x".repeat(5) }, OWNER)).rejects.toMatchObject({ details: { code: "NOT_REVERSIBLE" } });
  });

  it("warns when the item was counted again since — that count may already have corrected it", async () => {
    const m = await restock(b, 4);
    await recordCounts({ lines: [{ variantId: b, counted: 4 }] }, OWNER, `rev-count-${RUN}`);
    await expect(reverseStockMovement(m.id, { reason: "typed by mistake" }, OWNER)).rejects.toMatchObject({ details: { code: "COUNTED_SINCE" } });
    const r = await reverseStockMovement(m.id, { reason: "typed by mistake", acknowledgeLaterCount: true }, OWNER);
    expect(r.stock).toBe(0);
  });

  it("the reversed pair no longer alerts; a stock journal can't be reversed on its own; the route is the owner's", async () => {
    const alerts = await financeAlerts();
    const gains = alerts.alerts.find((x) => x.key === "inventory.gains");
    expect(gains?.detail ?? "").not.toContain("+200");

    const entry = await prisma.inventoryValuationEntry.findFirstOrThrow({ where: { variantId: a, qtyChange: 200 } });
    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "InventoryValuationEntry", sourceId: entry.id } });
    await expect(reverseJournal(journal.id, { reason: "try" }, OWNER)).rejects.toMatchObject({ details: { code: "JOURNAL_OWNED_BY_STOCK" } });

    const m = await restock(b, 2);
    const bad = await as(request(app).post(`/api/inventory/movements/${m.id}/reverse`)).send({ reason: "" });
    expect(bad.status).toBe(400);
    const ok = await as(request(app).post(`/api/inventory/movements/${m.id}/reverse`)).send({ reason: "typed by mistake" });
    expect(ok.status).toBe(200);
    expect(ok.body.stock).toBe(0);
  });

  it("the correction is booked on the mistake's own day, and profit shows it as a stock correction, not goods sold", async () => {
    const ctx = await getFinanceContext();
    const day = (d: Date) => businessDate(d, ctx.business.timezone);
    const today = day(new Date());
    // The entry is dated on another day than its correction (costing went live today, so that day is tomorrow): the
    // correction must follow the entry's day, not the day it was made — the 24/25 Oct gain-then-loss can't recur.
    const entryAt = new Date(Date.now() + 86_400_000);
    const window = { from: today, to: day(entryAt) };
    await postPending(); // earlier tests' entries in first, so only this one is measured
    const before = await profitByDay(window);
    const mistake = await restock(a, 10);
    await prisma.stockMovement.update({ where: { id: mistake.id }, data: { createdAt: entryAt } });
    await postPending();
    const r = await reverseStockMovement(mistake.id, { reason: "typed by mistake" }, OWNER);
    await postPending();
    const entry = await prisma.inventoryValuationEntry.findUniqueOrThrow({ where: { stockMovementId: r.movement.id } });
    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "InventoryValuationEntry", sourceId: entry.id } });
    expect(journal.entryDate.toISOString().slice(0, 10)).toBe(day(entryAt));

    const after = await profitByDay(window);
    for (const d of after.days) expect(d.salesProfit - d.stockCorrections).toBeCloseTo(d.profit, 2);
    // the gain and its correction moved stock corrections only — never goods sold or the profit from selling
    expect(after.totals.goods).toBeCloseTo(before.totals.goods, 2);
    expect(after.totals.salesProfit).toBeCloseTo(before.totals.salesProfit, 2);
    expect(after.totals.stockCorrections).toBeCloseTo(before.totals.stockCorrections, 2); // they cancel
    expect(await checks()).toEqual(MATCHED);
  });
});
