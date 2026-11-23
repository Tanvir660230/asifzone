import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS, addDays } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { ensurePurchasingAccounting } from "./purchasing-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { approveCutover, draftCutover, postCutover } from "./inventory-cutover.service";
import { processFinancialEvent } from "./events.service";
import { runReconciliation } from "./reconciliation.service";
import { ensureManufacturingSetup } from "../manufacturing/manufacturing-setup.service";
import { createMaterial } from "../manufacturing/materials.service";
import { spending } from "./spending.service";
import { addCost } from "./add-cost.service";
import { financeAlerts } from "./finance-alerts.service";

// Add cost (docs/FINANCE_ADD_COST.md): one form for anything paid for. Each kind lands in the record the books already had
// for it, the owner's own money comes in and pays in one step, and an undo takes both back out.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
const api = () => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/v1/finance${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
  };
};
async function postPending() {
  for (let round = 0; round < 10; round++) {
    const waiting = await prisma.financialEvent.findMany({ where: { status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true } });
    if (!waiting.length) return;
    for (const e of waiting) await processFinancialEvent(e.id);
  }
}
const CHECKS = ["ledger.integrity", "treasury.integrity", "events.unposted", "inventory.valuation_vs_ledger", "inventory.quantity_vs_valuation", "inventory.valuation_postings", "purchasing.grni", "payables.subledger"];
async function booksMatch() {
  await postPending();
  const r = await runReconciliation({ checks: CHECKS }, OWNER);
  expect(Object.fromEntries(r.results.map((x) => [x.checkKey, x.status]))).toEqual(Object.fromEntries(CHECKS.map((c) => [c, "MATCHED"])));
}
async function net(accountId: string) {
  const s = await prisma.journalLine.aggregate({ where: { accountId, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100;
}
async function mapped(key: string) {
  const { business } = await getFinanceContext();
  return (await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key } } })).accountId;
}
const spent = async () => (await spending({ from: "2026-09-01", to: today })).total;

let bank = "";
let ad = "";
let oil = "";
let today = "";
let options: { owner: { name: string; canUse: boolean }; expenseAccounts: Array<{ id: string; name: string }>; defaults: { packagingAccountId: string | null; otherAccountId: string | null }; purchases: Array<{ id: string }>; costingLive: boolean };

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  today = businessToday(ctx.business);
  await ensureCommerceAccounting(OWNER);
  await ensurePurchasingAccounting(OWNER);
  await ensureManufacturingSetup(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "AC-SEED", name: "seed", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  oil = (await createMaterial({ name: `Vitest AC oil ${RUN}`, stockUnit: "ml", variants: [{ sku: `AC-OIL-${RUN}`, spec: "oil" }] }, OWNER, { canSeeCost: true })).variants[0]!.id;
  const b = await api().post("/financial-accounts", { kind: "BANK", name: `Bank AC ${RUN}`, openingBalance: { amount: 100000, date: "2026-09-01" } });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  bank = b.body.id;
  const a = await api().post("/financial-accounts", { kind: "AD_PLATFORM", name: `Meta AC ${RUN}`, provider: "Meta", accountReference: "act_ac" });
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  ad = a.body.id;
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
    await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "variantId" IN (SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.kind = 'MATERIAL' AND p.name LIKE 'Vitest AC %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "ProductVariant" WHERE "productId" IN (SELECT id FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest AC %')`);
    await tx.$executeRawUnsafe(`DELETE FROM "Product" WHERE kind = 'MATERIAL' AND name LIKE 'Vitest AC %'`);
  });
  await cleanupFixtures();
});

describe("add cost — before stock costing is live", () => {
  it("a carrying cost with no stock values yet is a purchase charge, not lost", async () => {
    const before = await spent();
    const r = await api().post("/costs", { kind: "BRINGING", amount: 300, note: "Van from Chawkbazar", paidFrom: { kind: "ACCOUNT", financialAccountId: bank } }, `ac-bring-early-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.cost).toMatchObject({ source: "Expense", title: "Van from Chawkbazar" });
    expect(await net(await mapped("expense.freight_in"))).toBe(300);
    expect(Math.round((await spent()) - before)).toBe(300);
  });
});

describe("add cost", () => {
  it("go-live, then the options: whose money, the offered costs (no accountant's accounts), the purchases", async () => {
    await draftCutover({}, OWNER);
    await approveCutover({ acknowledgeMissing: true }, OWNER);
    await postCutover(OWNER);
    const bought = await api().post("/stock/purchases", { lines: [{ variantId: oil, quantity: 500, amount: 12000 }], documentTotal: 500, extras: [], paidFrom: { financialAccountId: bank } }, `ac-oil-${RUN}`);
    expect(bought.status, JSON.stringify(bought.body)).toBeLessThan(300);
    const r = await api().get("/costs/options");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    options = r.body;
    expect(options.owner.canUse).toBe(true);
    expect(options.costingLive).toBe(true);
    expect(options.purchases.length).toBeGreaterThan(0);
    const names = options.expenseAccounts.map((a) => a.name);
    expect(names).toContain("Rent");
    for (const hidden of ["Depreciation", "Cash over / short", "Expenses awaiting allocation", "Payment gateway fees", "Salaries & wages"]) expect(names).not.toContain(hidden);
    expect(options.defaults.packagingAccountId).toBeTruthy();
  });

  it("packaging paid with Asif's own money: his money comes in as capital and pays it — one step, counted once", async () => {
    const capital = await mapped("equity.owner_capital");
    const [capBefore, before] = [await net(capital), await spent()];
    const r = await api().post("/costs", { kind: "PACKAGING", amount: 2200, note: "Packing tape, 10 rolls", payee: "Local market", paidFrom: { kind: "OWNER" } }, `ac-tape-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.cost).toMatchObject({ source: "Expense", kind: "PACKAGING", title: "Packing tape, 10 rolls", amount: 2200 });
    expect(await net(capital)).toBe(capBefore - 2200);
    expect(await net(options.defaults.packagingAccountId!)).toBe(2200);
    const pocket = await prisma.financialAccount.findFirstOrThrow({ where: { name: options.owner.name } });
    expect(await net(pocket.ledgerAccountId)).toBe(0); // in and out the same day
    expect(Math.round((await spent()) - before)).toBe(2200);
    const again = await api().post("/costs", { kind: "PACKAGING", amount: 2200, note: "Packing tape, 10 rolls", paidFrom: { kind: "OWNER" } }, `ac-tape-${RUN}`);
    expect(again.status).toBe(200);
    expect(again.body.cost.id).toBe(r.body.cost.id);
    expect(await net(capital)).toBe(capBefore - 2200);
  });

  it("a bill from the bank goes on the chosen account; one not offered is refused", async () => {
    const rent = options.expenseAccounts.find((a) => a.name === "Rent")!.id;
    const r = await api().post("/costs", { kind: "BILL", amount: 8000, expenseAccountId: rent, note: "Shop rent, November", paidFrom: { kind: "ACCOUNT", financialAccountId: bank } }, `ac-rent-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await net(rent)).toBe(8000);
    const depreciation = await mapped("expense.depreciation");
    const bad = await api().post("/costs", { kind: "BILL", amount: 1, expenseAccountId: depreciation, paidFrom: { kind: "ACCOUNT", financialAccountId: bank } }, `ac-bad-${RUN}`);
    expect(bad.status).toBe(400);
    expect(bad.body.details?.code).toBe("EXPENSE_ACCOUNT");
  });

  it("a year's domain counts whole in spending the day it is paid, and in profit a month at a time", async () => {
    const before = await spent();
    const r = await api().post("/costs", { kind: "YEARLY", amount: 1200, months: 12, note: "Domain asifzone.com", paidFrom: { kind: "OWNER" } }, `ac-domain-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.cost.source).toBe("PrepaidCost");
    const p = await prisma.prepaidCost.findUniqueOrThrow({ where: { id: r.body.cost.id } });
    expect(p.serviceStart.toISOString().slice(0, 10)).toBe(today);
    expect(Math.round((await spent()) - before)).toBe(1200);
    expect(await net(await mapped("asset.prepaid"))).toBeLessThanOrEqual(1200);
  });

  it("carrying the goods adds to what the latest purchase is worth, and the books still match", async () => {
    const r = await api().post("/costs", { kind: "BRINGING", amount: 400, note: "Rickshaw", paidFrom: { kind: "ACCOUNT", financialAccountId: bank } }, `ac-carry-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.cost.source).toBe("LandedCost");
    const l = await prisma.landedCost.findUniqueOrThrow({ where: { id: r.body.cost.id } });
    expect(l.goodsReceiptIds).toEqual([options.purchases[0]!.id]);
    await booksMatch();
  });

  it("equipment is bought and registered in one step, its cost on the asset account", async () => {
    const r = await api().post("/costs", { kind: "EQUIPMENT", amount: 8000, note: "Label printer", usefulLifeMonths: 36, paidFrom: { kind: "OWNER" } }, `ac-printer-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const a = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: r.body.cost.id } });
    expect(a).toMatchObject({ name: "Label printer", usefulLifeMonths: 36, sourceType: "MONEY_MOVEMENT" });
    expect(await net(a.assetAccountId)).toBe(8000);
  });

  it("Meta paid by Asif's card: his money goes straight into the ad account (the daily spend comes from Ads)", async () => {
    const before = await net((await prisma.financialAccount.findUniqueOrThrow({ where: { id: ad } })).ledgerAccountId);
    const r = await api().post("/costs", { kind: "ADS", amount: 5000, paidFrom: { kind: "OWNER" } }, `ac-meta-${RUN}`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.cost.source).toBe("AdTopUp");
    expect(await net((await prisma.financialAccount.findUniqueOrThrow({ where: { id: ad } })).ledgerAccountId)).toBe(before + 5000);
  });

  it("only the owner may pay with the owner's money; a date in the future or before the books is refused", async () => {
    const staff: FinanceActor = { type: "ADMIN", adminId: admin, label: "staff@test", permissions: PERMISSIONS.filter((p) => p !== "finance.sensitive") };
    await expect(addCost({ kind: "OTHER", amount: 10, paidFrom: { kind: "OWNER" } }, staff, `ac-staff-${RUN}`)).rejects.toMatchObject({ statusCode: 403 });
    await expect(addCost({ kind: "OTHER", amount: 10, date: "2099-01-01", paidFrom: { kind: "ACCOUNT", financialAccountId: bank } }, OWNER, `ac-future-${RUN}`)).rejects.toMatchObject({ statusCode: 400 });
    await expect(addCost({ kind: "OTHER", amount: 10, date: "2026-08-01", paidFrom: { kind: "ACCOUNT", financialAccountId: bank } }, OWNER, `ac-early-${RUN}`)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("undo a cost", () => {
  it("an owner-paid expense goes, and so does the owner's money that came in for it", async () => {
    const capital = await mapped("equity.owner_capital");
    const r = await api().post("/costs", { kind: "OTHER", amount: 350, note: "Tea for the team", paidFrom: { kind: "OWNER" } }, `ac-tea-${RUN}`);
    const [capBefore, before] = [await net(capital), await spent()];
    const u = await api().post("/costs/undo", { source: "Expense", id: r.body.cost.id, reason: "entered twice" });
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect(await net(capital)).toBe(capBefore + 350);
    expect(Math.round(before - (await spent()))).toBe(350);
    const rows = (await spending({ from: "2026-09-01", to: today })).days.flatMap((d) => d.rows);
    expect(rows.some((x) => x.title === "Tea for the team")).toBe(false);
  });

  it("a prepaid cost goes with its monthly shares; a carrying cost goes with the stock value it added", async () => {
    const before = await spent();
    const y = await api().post("/costs", { kind: "YEARLY", amount: 600, months: 6, note: "Hosting six months", paidFrom: { kind: "ACCOUNT", financialAccountId: bank } }, `ac-host-${RUN}`);
    const c = await api().post("/costs", { kind: "BRINGING", amount: 120, note: "Courier of the oil", paidFrom: { kind: "ACCOUNT", financialAccountId: bank } }, `ac-carry2-${RUN}`);
    expect([y.status, c.status]).toEqual([201, 201]);
    expect((await api().post("/costs/undo", { source: "PrepaidCost", id: y.body.cost.id, reason: "wrong card" })).status).toBe(200);
    expect((await api().post("/costs/undo", { source: "LandedCost", id: c.body.cost.id, reason: "not ours" })).status).toBe(200);
    expect(Math.round((await spent()) - before)).toBe(0);
    await booksMatch();
  });
});

describe("ads behind", () => {
  it("ads recorded and then stopped for more than 3 days are flagged, even with no campaign marked running", async () => {
    const { business } = await getFinanceContext();
    const c = await prisma.adCampaign.create({ data: { businessId: business.id, financialAccountId: ad, name: `Old ${RUN}`, startDate: new Date(`${addDays(today, -10)}T00:00:00Z`), endDate: new Date(`${addDays(today, -10)}T00:00:00Z`), isActive: false } });
    await prisma.adSpendDay.create({ data: { campaignId: c.id, date: new Date(`${addDays(today, -10)}T00:00:00Z`), source: "MANUAL", amount: "500" } });
    const all = (await financeAlerts()).alerts;
    const alert = all.find((a) => a.key === "ads.behind");
    expect(alert, JSON.stringify(all.map((a) => [a.key, a.detail]))).toBeTruthy();
    expect(alert?.detail).toContain(addDays(today, -10));
    await prisma.adCampaign.update({ where: { id: c.id }, data: { endDate: new Date(`${addDays(today, -1)}T00:00:00Z`) } });
    await prisma.adSpendDay.create({ data: { campaignId: c.id, date: new Date(`${addDays(today, -1)}T00:00:00Z`), source: "MANUAL", amount: "500" } });
    expect((await financeAlerts()).alerts.find((a) => a.key === "ads.behind")).toBeUndefined();
    await prisma.adSpendDay.deleteMany({ where: { campaignId: c.id } });
    await prisma.adCampaign.delete({ where: { id: c.id } });
  });
});
