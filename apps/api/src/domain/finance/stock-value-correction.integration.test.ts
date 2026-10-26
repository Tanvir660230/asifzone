import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { ensurePurchasingAccounting } from "./purchasing-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "./inventory-cutover.service";
import { processFinancialEvent } from "./events.service";
import { runReconciliation } from "./reconciliation.service";
import { adjustVariantStockInTx, afterAdjustment } from "../../modules/inventory/inventory.service";
import { correctStockValues } from "./stock-value-correction.service";

// The owner's stock value correction (docs/STOCK_HUB.md §12), on the 27 Oct caps case: 2 caps valued at ৳587 at go-live
// and 3 that came in with no value, all really from the batch that cost ৳476.77 a piece.

let OWNER: FinanceActor & { type: "ADMIN" };
let owner = "";
let cap = "";
const UNIT = 476.77;

async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
async function balance(code: string) {
  const r = await prisma.$queryRaw<Array<{ n: string | null }>>`
    SELECT SUM(l.debit - l.credit)::text AS n FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "LedgerAccount" a ON a.id = l."accountId"
    WHERE a.code = ${code} AND e.status = 'POSTED'`;
  return Math.round(Number(r[0]?.n ?? 0) * 100) / 100;
}
async function checks() {
  await postPending();
  const r = await runReconciliation({ checks: ["inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "ledger.integrity"] }, OWNER);
  return Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]));
}
const MATCHED = { "inventory.valuation_vs_ledger": "MATCHED", "inventory.quantity_vs_valuation": "MATCHED", "inventory.valuation_postings": "MATCHED", "ledger.integrity": "MATCHED" };

beforeAll(async () => {
  await purgeFinanceTables();
  owner = await ownerId();
  OWNER = { type: "ADMIN", adminId: owner, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const p = await createStockedProduct({ stocks: [2], basePrice: 999 });
  cap = p.variants[0]!.id;
  await saveOpeningInventory([{ variantId: cap, sku: cap, name: cap, quantity: 2, unitCost: 587, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  // three more on the shelf with no value (a hand entry / a count gain)
  const found = await prisma.$transaction((tx) => adjustVariantStockInTx(tx, cap, 3, "ADJUSTMENT", owner, "on the shelf, no value", { unvaluedGain: true }));
  afterAdjustment(found);
  await postPending();
}, 120_000);

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("stock value correction", () => {
  it("previews every held unit at the new cost and writes nothing", async () => {
    const before = await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: cap } });
    expect(before).toMatchObject({ valuedQty: 2, unvaluedQty: 3 });
    const r = await correctStockValues({ reason: "B caps were the new batch", lines: [{ variantId: cap, unitCost: UNIT }] }, OWNER, null);
    expect(r.committed).toBe(false);
    expect(r.lines[0]).toMatchObject({ held: 5, unvalued: 3, valueBefore: 1174, valueAfter: 2383.85, change: 1209.85 });
    expect(await prisma.inventoryValuationEntry.count({ where: { sourceType: "StockValueCorrection" } })).toBe(0);
  });

  it("only the owner commits it", async () => {
    const manager = { ...OWNER, permissions: PERMISSIONS.filter((p) => p !== "finance.sensitive") };
    await expect(correctStockValues({ reason: "B caps were the new batch", lines: [{ variantId: cap, unitCost: UNIT }], commit: true }, manager, `vc-${RUN}-m`)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("commits: all units valued at the new cost, the change against opening balance equity, the books match", async () => {
    const [inv0, eq0, cogs0] = [await balance("1610"), await balance("3900"), await balance("5100")];
    const r = await correctStockValues({ reason: "B caps were the new batch", lines: [{ variantId: cap, unitCost: UNIT }], commit: true }, OWNER, `vc-${RUN}`);
    expect(r).toMatchObject({ committed: true, replayed: false, total: 1209.85 });
    const state = await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: cap } });
    expect(state).toMatchObject({ valuedQty: 5, unvaluedQty: 0, deficitQty: 0 });
    expect(Number(state.value)).toBe(2383.85);
    await postPending();
    expect(await balance("1610")).toBeCloseTo(inv0 + 1209.85, 2);
    expect(await balance("3900")).toBeCloseTo(eq0 - 1209.85, 2); // credited
    expect(await balance("5100")).toBe(cogs0); // no sale re-costed
    expect(await checks()).toEqual(MATCHED);
    await assertInventoryInvariants(cap);
  });

  it("the same key replays; the next sale takes the corrected cost", async () => {
    const again = await correctStockValues({ reason: "B caps were the new batch", lines: [{ variantId: cap, unitCost: UNIT }], commit: true }, OWNER, `vc-${RUN}`);
    expect(again.replayed).toBe(true);
    expect(await prisma.inventoryValuationEntry.count({ where: { sourceType: "StockValueCorrection" } })).toBe(1);
    const order = await placeOrder([{ variantId: cap, quantity: 1 }], { customerPhone: "01712000091" });
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id }, select: { unitCostSnapshot: true } });
    expect(line.unitCostSnapshot).toBe(47677);
    expect(await checks()).toEqual(MATCHED);
  });
});
