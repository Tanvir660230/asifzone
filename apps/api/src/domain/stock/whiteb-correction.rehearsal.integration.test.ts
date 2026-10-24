import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
import * as inventory from "../../modules/inventory/inventory.service";
import { adjustVariantStockInTx, afterAdjustment } from "../../modules/inventory/inventory.service";
import { recordCounts } from "./count.service";

// Inventory recovery phase 3 — rehearsal of the White B correction (Premium Pakistani Cap - White B) on a private copy of
// its production state read at 2026-10-24 15:22 Dhaka. The 22 Oct count sheet says XS 8 · S 25 · M 29 · L 19 · XL 2 new
// (+2 old = 4) · 2XL 2 old; on 24 Oct the sheet's total (83) was typed into XS, S got XS's 8, S's 25 and XL's 2 were never
// entered. One M has sold since (on an order not yet with the courier). Nothing here touches production.

const SIZES = ["XS", "S", "M", "L", "XL", "2XL"] as const;
type Size = (typeof SIZES)[number];
let OWNER: FinanceActor;
let owner = "";
let productId = "";
const v = {} as Record<Size, string>;

const credits5210 = async () => Number((await prisma.$queryRaw<Array<{ c: string | null }>>`
  SELECT SUM(l.credit)::text AS c FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id = l."accountId" WHERE a.code = '5210'`)[0]?.c ?? 0);
const stocks = async () => Object.fromEntries(await Promise.all(SIZES.map(async (s) => [s, await stockOf(v[s])])));
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

/** The production request (Stock › Counted, POST /api/v1/finance/stock/counts) — the same body is prepared for the owner. */
const correction = () => ({
  date: undefined,
  products: [productId],
  lines: [
    { variantId: v.XS, counted: 8, reason: "COUNT_FIX" as const, note: "22 Oct sheet: XS 8 — 24 Oct entry typed the sheet total (83) into XS" },
    { variantId: v.S, counted: 25, reason: "COUNT_FIX" as const, note: "22 Oct sheet: S 25 — 24 Oct entry put XS's 8 here" },
    { variantId: v.M, counted: 29, note: "22 Oct sheet: M 29 (1 on an order not yet shipped)" },
    { variantId: v.L, counted: 19, note: "22 Oct sheet: L 19" },
    { variantId: v.XL, counted: 4, reason: "COUNT_FIX" as const, note: "22 Oct sheet: XL 2 new + 2 old — the 2 new were never entered" },
    { variantId: v["2XL"], counted: 2, note: "2 old, none on the sheet" },
  ],
});

beforeAll(async () => {
  await purgeFinanceTables();
  owner = await ownerId();
  OWNER = { type: "ADMIN", adminId: owner, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  // before the 24 Oct entries: XL 2 and 2XL 2 old caps at 587 (production: 2XL holds 1 valued + 1 unvalued — the
  // correction leaves 2XL untouched, so this rehearsal values both)
  const p = await createStockedProduct({ stocks: [0, 0, 0, 0, 2, 2], basePrice: 1450 });
  productId = p.product.id;
  p.variants.forEach((x, i) => (v[SIZES[i]!] = x.id));
  const opening = (variantId: string) => ({ variantId, sku: variantId, name: variantId, quantity: 2, unitCost: 587, valuationStatus: "KNOWN" as const, valuationMethod: "SUPPLIER_INVOICE" as const, valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id });
  await saveOpeningInventory([opening(v.XL), opening(v["2XL"])], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
  // the 24 Oct 13:58–14:02 entries through Inventory › Adjust (RESTOCK, no cost known → unvalued)
  for (const [size, qty] of [["XS", 83], ["S", 8], ["M", 29], ["L", 19]] as const) {
    const r = await prisma.$transaction((tx) => adjustVariantStockInTx(tx, v[size], qty, "RESTOCK", owner, null));
    afterAdjustment(r);
  }
  // 15:20: one M sold, not yet booked with the courier
  await placeOrder([{ variantId: v.M, quantity: 1 }], { customerPhone: "01712000061" });
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("White B correction (rehearsal)", () => {
  let before5210 = 0;

  it("starts from production's state: XS 83 · S 8 · M 28 (+1 waiting) · L 19 · XL 2 · 2XL 2", async () => {
    expect(await stocks()).toEqual({ XS: 83, S: 8, M: 28, L: 19, XL: 2, "2XL": 2 });
    expect(await checks()).toEqual(MATCHED);
    before5210 = await credits5210();
  });

  it("refuses the correction with a size left off, before writing anything", async () => {
    const { lines, ...rest } = correction();
    await expect(recordCounts({ ...rest, lines: lines.filter((l) => l.variantId !== v.XL) }, OWNER, `whiteb-partial-${RUN}`)).rejects.toMatchObject({ details: { code: "COUNT_SCOPE_INCOMPLETE" } });
    expect(await stocks()).toEqual({ XS: 83, S: 8, M: 28, L: 19, XL: 2, "2XL": 2 });
  });

  it("T-13: interrupted after XS (S fails), retried with the same key → resumes from S, one movement per size", async () => {
    let calls = 0;
    const real = inventory.adjustVariantStockInTx;
    const spy = vi.spyOn(inventory, "adjustVariantStockInTx").mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error("connection lost (simulated)");
      return real(...args);
    });
    await expect(recordCounts(correction(), OWNER, `whiteb-fix-${RUN}`)).rejects.toThrow("connection lost");
    spy.mockRestore();
    expect(await stocks()).toEqual({ XS: 8, S: 8, M: 28, L: 19, XL: 2, "2XL": 2 }); // XS done, the rest not yet
    const entry = await prisma.stockHubEntry.findFirstOrThrow({ where: { idempotencyKey: { endsWith: `whiteb-fix-${RUN}` } } });
    expect(entry.completedAt).toBeNull();
  });

  it("T-12: the correction (resumed): XS −75 · S +17 · XL +2, M L 2XL unchanged — no income booked, the books still match", async () => {
    const r = await recordCounts(correction(), OWNER, `whiteb-fix-${RUN}`);
    expect(r.lines.map((l) => l.difference)).toEqual([-75, 17, 0, 0, 2, 0]);
    // one set of movements: one count movement for each size that changed, none for the others (T-13)
    const counted = await prisma.stockMovement.groupBy({ by: ["variantId"], where: { variantId: { in: SIZES.map((s) => v[s]) }, sourceType: "StockHubEntry" }, _count: { _all: true }, _sum: { change: true } });
    expect(Object.fromEntries(counted.map((c) => [SIZES.find((s) => v[s] === c.variantId), [c._count._all, c._sum.change]]))).toEqual({ XS: [1, -75], S: [1, 17], XL: [1, 2] });
    expect(await stocks()).toEqual({ XS: 8, S: 25, M: 28, L: 19, XL: 4, "2XL": 2 });
    expect(await credits5210()).toBe(before5210); // the 19 units counted in carry no value until their cost is entered
    const xl = await prisma.inventoryCostState.findUniqueOrThrow({ where: { variantId: v.XL } });
    expect(xl).toMatchObject({ valuedQty: 2, unvaluedQty: 2 }); // the 2 old at 587, the 2 new waiting for their cost
    expect(await checks()).toEqual(MATCHED);
    for (const s of SIZES) await assertInventoryInvariants(v[s]);
    // a retry with the same key replays it: nothing is booked twice
    const again = await recordCounts(correction(), OWNER, `whiteb-fix-${RUN}`);
    expect(again.replayed).toBe(true);
    expect(await stocks()).toEqual({ XS: 8, S: 25, M: 28, L: 19, XL: 4, "2XL": 2 });
  });

  it("the reversal (if the owner withdraws it) puts every size back and the books still match", async () => {
    const r = await recordCounts({
      products: [productId],
      lines: [
        { variantId: v.XS, counted: 83, reason: "COUNT_FIX", note: "reversal of the White B correction" },
        { variantId: v.S, counted: 8, reason: "COUNT_FIX", note: "reversal of the White B correction" },
        { variantId: v.M, counted: 29 },
        { variantId: v.L, counted: 19 },
        { variantId: v.XL, counted: 2, reason: "COUNT_FIX", note: "reversal of the White B correction" },
        { variantId: v["2XL"], counted: 2 },
      ],
    }, OWNER, `whiteb-reverse-${RUN}`);
    expect(r.lines.map((l) => l.difference)).toEqual([75, -17, 0, 0, -2, 0]);
    expect(await stocks()).toEqual({ XS: 83, S: 8, M: 28, L: 19, XL: 2, "2XL": 2 });
    expect(await credits5210()).toBe(before5210);
    expect(await checks()).toEqual(MATCHED);
  });
});
