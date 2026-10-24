import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
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
import { adjustVariantStockInTx, afterAdjustment } from "../../modules/inventory/inventory.service";
import { recordCounts } from "./count.service";

// Inventory recovery phase 4 — rehearsal of option A for an attar entered through Inventory › Adjust without real goods
// and valued at the average (as AZE-001 / AZ-FRG-12ML-001 on 24 Oct: Dr 1610 / Cr 5210). Counting the real filled bottles
// (COUNT_FIX) takes the phantom bottles out at the same average against 5210, so the gain nets to zero, the orders placed
// meanwhile stay owed (to be filled) and the books match. Private test data only; no production reversal.

let OWNER: FinanceActor;
let owner = "";
let attar = "";

const net5210 = async () => Number((await prisma.$queryRaw<Array<{ n: string | null }>>`
  SELECT SUM(l.credit - l.debit)::text AS n FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id = l."accountId" WHERE a.code = '5210'`)[0]?.n ?? 0);
async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}

beforeAll(async () => {
  await purgeFinanceTables();
  owner = await ownerId();
  OWNER = { type: "ADMIN", adminId: owner, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  // 5 real filled bottles at 500 each before the entry
  const p = await createStockedProduct({ stocks: [5], basePrice: 950 });
  await prisma.product.update({ where: { id: p.product.id }, data: { fillToOrder: true } });
  attar = p.variants[0]!.id;
  await saveOpeningInventory([{ variantId: attar, sku: "ATR", name: "attar", quantity: 5, unitCost: 500, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("attar option A: entered without real goods → count the real bottles", () => {
  it("the bad entry: +50 at the 500 average credits 5210 25,000; then 3 sold (not yet shipped)", async () => {
    await postPending();
    const before = await net5210();
    const r = await prisma.$transaction((tx) => adjustVariantStockInTx(tx, attar, 50, "RESTOCK", owner, null));
    afterAdjustment(r);
    await placeOrder([{ variantId: attar, quantity: 3 }], { customerPhone: "01712000071" });
    await postPending();
    expect(await stockOf(attar)).toBe(52);
    expect(Math.round((await net5210()) - before)).toBe(25_000);
  });

  it("count 5 real bottles (COUNT_FIX): −50 at 500 against 5210 → the gain nets to 0, stock 2 with 3 on the shelf for the order", async () => {
    const before = await net5210();
    const r = await recordCounts({ lines: [{ variantId: attar, counted: 5, reason: "COUNT_FIX", note: "24 Oct +50 entered without bottles" }] }, OWNER, `attar-a-${RUN}`);
    expect(r.lines[0]).toMatchObject({ expected: 55, difference: -50 });
    await postPending();
    expect(await stockOf(attar)).toBe(2);
    expect(Math.round((await net5210()) - before)).toBe(-25_000);
    const checks = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity"] }, OWNER);
    expect(checks.results.every((x) => x.status === "MATCHED")).toBe(true);
    await assertInventoryInvariants(attar);
  });
});
