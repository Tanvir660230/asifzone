import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { ensureCommerceAccounting } from "../finance/commerce-setup.service";
import { ensurePurchasingAccounting } from "../finance/purchasing-setup.service";
import { updateBusinessSettings } from "../finance/chart.service";
import { postOpeningBalances, saveOpeningInventory } from "../finance/opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "../finance/inventory-cutover.service";
import { financeAlerts } from "../finance/finance-alerts.service";
import { recordCounts } from "./count.service";
import { adjustVariantStockInTx, afterAdjustment } from "../../modules/inventory/inventory.service";
import { receiveReturnedParcel, updateOrderStatus } from "../../modules/orders/order.service";

// Inventory recovery (2026-10-24): once stock costing is live, stock only rises through a document (Bought, Filled, a
// count, a return) — never a free \"restock\" — and a parcel cancelled after it left comes back into stock only when it is
// physically received. Expected values are literals worked out by hand.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let owner = "";
let cap = "";
let capSizes: string[] = [];
let capProduct = "";
let attarProduct = "";
let attar = "";

const as = (adminId: string) => (r: request.Test) => r.set("Cookie", [`access_token=${signAccessToken({ adminId, role: "OWNER" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);
const stockOf = async (variantId: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { stock: true } })).stock;
const movementsOf = (variantId: string) => prisma.stockMovement.count({ where: { variantId } });
const countAdjustmentCredits = async () => {
  const r = await prisma.$queryRaw<Array<{ c: string | null }>>`
    SELECT SUM(l.credit)::text AS c FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id = l."accountId" WHERE a.code = '5210'`;
  return Number(r[0]?.c ?? 0);
};

beforeAll(async () => {
  await purgeFinanceTables();
  owner = await ownerId();
  OWNER = { type: "ADMIN", adminId: owner, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const caps = await createStockedProduct({ stocks: [10, 5, 0], basePrice: 900 });
  capProduct = caps.product.id;
  capSizes = caps.variants.map((v) => v.id);
  cap = capSizes[0]!;
  const bottles = await createStockedProduct({ stocks: [0], basePrice: 350 });
  await prisma.product.update({ where: { id: bottles.product.id }, data: { fillToOrder: true } });
  attarProduct = bottles.product.id;
  attar = bottles.variants[0]!.id;
  const opening = (variantId: string, quantity: number, unitCost: number) => ({ variantId, sku: variantId, name: variantId, quantity, unitCost, valuationStatus: "KNOWN" as const, valuationMethod: "SUPPLIER_INVOICE" as const, valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id });
  await saveOpeningInventory([opening(capSizes[0]!, 10, 100), opening(capSizes[1]!, 5, 100)], OWNER);
  await postOpeningBalances(OWNER);
  await draftCutover({}, OWNER);
  await approveCutover({ acknowledgeMissing: true }, OWNER);
  await postCutover(OWNER);
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("F-a / F-b: no free restock once costing is live", () => {
  it("refuses a RESTOCK through Inventory › Adjust and writes nothing (no movement, no 5210 gain)", async () => {
    const [stock, moves, gains] = [await stockOf(cap), await movementsOf(cap), await countAdjustmentCredits()];
    const r = await as(owner)(request(app).post(`/api/inventory/variants/${cap}/adjust`)).send({ delta: 50, reason: "RESTOCK", note: "new caps" });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.details?.code).toBe("STOCK_VIA_HUB");
    expect(String(r.body.error ?? r.body.message)).toMatch(/Bought|Filled/);
    expect(await stockOf(cap)).toBe(stock);
    expect(await movementsOf(cap)).toBe(moves);
    expect(await countAdjustmentCredits()).toBe(gains);
  });

  it("refuses a manual increase labelled ADJUSTMENT the same way", async () => {
    const stock = await stockOf(cap);
    const r = await as(owner)(request(app).post(`/api/inventory/variants/${cap}/adjust`)).send({ delta: 5, reason: "ADJUSTMENT", note: "typo fix" });
    expect(r.status).toBe(409);
    expect(r.body.details?.code).toBe("STOCK_VIA_HUB");
    expect(await stockOf(cap)).toBe(stock);
  });

  it("still allows a write-off (DAMAGED −1): stock 10 → 9", async () => {
    expect(await stockOf(cap)).toBe(10);
    const r = await as(owner)(request(app).post(`/api/inventory/variants/${cap}/adjust`)).send({ delta: -1, reason: "DAMAGED", note: "torn" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await stockOf(cap)).toBe(9);
  });
});

describe("F-c: a size grid must match its document", () => {
  it("refuses a purchase whose lines do not add up to the document total, before any write", async () => {
    const before = await prisma.stockHubEntry.count();
    const stocks = await Promise.all(capSizes.map(stockOf));
    const r = await as(owner)(request(app).post("/api/v1/finance/stock/purchases"))
      .set("Idempotency-Key", `grid-${RUN}`)
      .send({ supplierName: "Cap supplier", documentTotal: 83, paidFrom: { ownerPocket: true }, lines: [
        { variantId: capSizes[0], quantity: 83, amount: 48721 },
        { variantId: capSizes[1], quantity: 8, amount: 4696 },
        { variantId: capSizes[2], quantity: 48, amount: 28176 },
      ] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/139.*83|83.*139/);
    expect(await prisma.stockHubEntry.count()).toBe(before);
    expect(await Promise.all(capSizes.map(stockOf))).toEqual(stocks);
  });

  it("refuses a count that names a product but leaves one of its sizes out", async () => {
    const moves = await Promise.all(capSizes.map(movementsOf));
    await expect(
      recordCounts({ products: [capProduct], lines: [{ variantId: capSizes[0]!, counted: 9 }, { variantId: capSizes[1]!, counted: 5 }] } as never, OWNER, `count-scope-${RUN}`),
    ).rejects.toMatchObject({ details: { code: "COUNT_SCOPE_INCOMPLETE" } });
    expect(await Promise.all(capSizes.map(movementsOf))).toEqual(moves);
  });
});

describe("F-d: a parcel cancelled after it shipped comes back only when received", () => {
  it("cancelling a packed order puts the units back at once (unchanged)", async () => {
    const o = await placeOrder([{ variantId: capSizes[1]!, quantity: 1 }]);
    expect(await stockOf(capSizes[1]!)).toBe(4);
    await updateOrderStatus(o.id, { status: "CANCELLED", note: "customer changed mind" } as never, owner);
    expect(await stockOf(capSizes[1]!)).toBe(5);
  });

  it("cancelling after shipping leaves stock alone; receiving the parcel restores it exactly once", async () => {
    const o = await placeOrder([{ variantId: capSizes[1]!, quantity: 2 }]);
    expect(await stockOf(capSizes[1]!)).toBe(3);
    await updateOrderStatus(o.id, { status: "SHIPPED" } as never, owner);
    await updateOrderStatus(o.id, { status: "CANCELLED", note: "refused at the door" } as never, owner);
    expect(await stockOf(capSizes[1]!)).toBe(3); // the parcel is still with the courier
    // a duplicate courier push of the same status changes nothing
    await updateOrderStatus(o.id, { status: "CANCELLED" } as never, undefined, { quietNoop: true });
    expect(await stockOf(capSizes[1]!)).toBe(3);

    await receiveReturnedParcel(o.id, owner, {});
    expect(await stockOf(capSizes[1]!)).toBe(5);
    const back = await prisma.stockMovement.findMany({ where: { orderId: o.id, change: { gt: 0 } } });
    expect(back.map((m) => m.change)).toEqual([2]);

    await expect(receiveReturnedParcel(o.id, owner, {})).rejects.toMatchObject({ details: { code: "NOTHING_TO_RECEIVE" } });
    expect(await stockOf(capSizes[1]!)).toBe(5);
  });
});

describe("F-b: a count gain is never booked as income", () => {
  it("6 caps found (average 100): stock +6, held unvalued, nothing credited to 5210", async () => {
    const gains = await countAdjustmentCredits();
    await recordCounts({ lines: [{ variantId: capSizes[0]!, counted: 15, reason: "FOUND" }] }, OWNER, `count-gain-${RUN}`);
    expect(await stockOf(cap)).toBe(15);
    const entry = await prisma.inventoryValuationEntry.findFirstOrThrow({ where: { variantId: cap, stockMovement: { change: 6 } } });
    expect(entry.valuationStatus).toBe("MISSING");
    expect(Number(entry.valueChange)).toBe(0);
    expect(await countAdjustmentCredits()).toBe(gains);
  });
});

describe("F-e: owner alerts name the item, the quantity and what to do", () => {
  it("raises alerts for bottles added without a fill, stock received without a cost, and a valued gain above the threshold", async () => {
    await updateBusinessSettings({ inventoryGainAlertThreshold: 500, reason: "alert threshold" } as never, OWNER);
    // A count that finds 3 attar bottles nobody filled…
    await recordCounts({ lines: [{ variantId: attar, counted: 3, reason: "FOUND" }] }, OWNER, `count-alert-${RUN}`);
    // …and a gain valued at the average the way the old Adjust path booked one (5 × 100 = 500 against 5210), as entries
    // made before this fix are.
    const legacy = await prisma.$transaction((tx) => adjustVariantStockInTx(tx, capSizes[1]!, 5, "RESTOCK", owner, "legacy restock"));
    afterAdjustment(legacy);
    const { alerts } = await financeAlerts();
    const bottles = alerts.find((a) => a.key === "inventory.bottles_without_fill");
    expect(bottles?.count).toBe(1);
    expect(bottles?.detail).toMatch(/\+3/);
    const unvalued = alerts.find((a) => a.key === "inventory.unvalued_receipts");
    expect(unvalued?.count).toBe(2); // the 6 caps found (F-b) and the 3 bottles
    expect(unvalued?.detail).toMatch(/\+6/);
    const gains = alerts.find((a) => a.key === "inventory.gains");
    expect(gains?.count).toBe(1);
    expect(gains?.amount).toBe(500);
    expect(gains?.detail).toMatch(/\+5 \(restock/);
  });

  it("does not raise the gain alert below the threshold", async () => {
    await updateBusinessSettings({ inventoryGainAlertThreshold: 1000, reason: "alert threshold" } as never, OWNER);
    const { alerts } = await financeAlerts();
    expect(alerts.find((a) => a.key === "inventory.gains")).toBeUndefined();
  });
});
