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
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { financeTransaction } from "./finance-tx";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";

// Finance Center (docs/FINANCE_CENTER.md): a budget change never rewrites past days, USD spend at the default rate is an
// estimate, a CSV import is previewed, de-duplicated and all-or-nothing, a split expense never counts twice, subscriptions
// remind before they end, SMS usage comes from balance readings, and a reported figure is never shown as confirmed.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin: string;
const api = () => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/v1/finance${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
    patch: (url: string, body: object = {}) => auth(request(app).patch(`/api/v1/finance${url}`)).send(body),
    put: (url: string, body: object = {}) => auth(request(app).put(`/api/v1/finance${url}`)).send(body),
  };
};
let bank = "";
let adAccount = "";
let acc: Record<string, string> = {};
let today = "";

async function balanceOf(mappingKeyOrAccountId: string) {
  const { business } = await getFinanceContext();
  const m = await prisma.accountMapping.findUnique({ where: { businessId_key: { businessId: business.id, key: mappingKeyOrAccountId } } });
  const s = await prisma.journalLine.aggregate({ where: { accountId: m?.accountId ?? mappingKeyOrAccountId, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100;
}

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  today = businessToday(ctx.business);
  await ensureCommerceAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-09-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "OB-FC", name: "seed", quantity: 5, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-09-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  await financeTransaction((tx) => ensureOwnerBooksSetupInTx(tx, ctx.business, OWNER));
  acc = Object.fromEntries(((await api().get("/accounts")).body.accounts as Array<{ id: string; code: string }>).map((a) => [a.code, a.id]));
  const b = await api().post("/financial-accounts", { kind: "BANK", name: `Bank ${RUN}`, openingBalance: { amount: 100000, date: "2026-09-01" } });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  bank = b.body.id;
  const a = await api().post("/financial-accounts", { kind: "AD_PLATFORM", name: `Meta ads ${RUN}`, provider: "Meta" });
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  adAccount = a.body.id;
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("advertising", () => {
  it("raising a budget never rewrites the days before the change", async () => {
    const start = addDays(today, -6);
    const c = await api().post("/ads/campaigns", { financialAccountId: adAccount, name: `Budget ${RUN}`, startDate: start, budgetType: "DAILY", budget: 500 });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const before = await balanceOf("expense.advertising");
    expect(before).toBe(3000); // six ended days at 500
    const from = addDays(today, -2);
    const u = await api().patch(`/ads/campaigns/${c.body.id}`, { budget: 800, budgetFrom: from });
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    // four days at 500 stay; the two days from the change are 800
    expect(await balanceOf("expense.advertising")).toBe(4 * 500 + 2 * 800);
    expect(u.body.budgetHistory.map((b: { from: string; budget: number }) => [b.from, b.budget])).toEqual([[start, 500], [from, 800]]);
    // an actual figure still replaces the planned day, whatever the budget was
    await api().put(`/ads/campaigns/${c.body.id}/spend`, { date: start, amount: 470 });
    expect(await balanceOf("expense.advertising")).toBe(470 + 3 * 500 + 2 * 800);
    await api().patch(`/ads/campaigns/${c.body.id}`, { isActive: false });
  });

  it("spend in USD: at a given rate it is exact; at the default rate it is marked an estimate; no rate at all is refused", async () => {
    const c = await api().post("/ads/campaigns", { financialAccountId: adAccount, name: `USD ${RUN}`, startDate: addDays(today, -3) });
    const day = addDays(today, -3);
    const none = await api().put(`/ads/campaigns/${c.body.id}/spend`, { date: day, originalAmount: 4.72, currency: "USD" });
    expect(none.status).toBe(400);
    expect(none.body.details.code).toBe("SPEND_RATE");
    expect((await api().patch("/center/settings", { defaultUsdRate: 122 })).status).toBe(200);
    expect((await api().put(`/ads/campaigns/${c.body.id}/spend`, { date: day, originalAmount: 4.72, currency: "USD" })).status).toBe(200);
    const row = await prisma.adSpendDay.findFirstOrThrow({ where: { campaignId: c.body.id } });
    expect(Number(row.amount)).toBe(575.84); // 4.72 × 122
    expect(row.originalCurrency).toBe("USD");
    const v = await api().get("/center/verifications?status=ESTIMATED");
    expect(v.body.items.map((i: { entityId: string }) => i.entityId)).toContain(row.id);
    // the card statement's own rate makes it exact again
    await api().put(`/ads/campaigns/${c.body.id}/spend`, { date: day, originalAmount: 4.72, currency: "USD", fxRate: 124.5 });
    expect(Number((await prisma.adSpendDay.findUniqueOrThrow({ where: { id: row.id } })).amount)).toBe(587.64);
    expect((await api().get("/center/verifications?status=ESTIMATED")).body.items.map((i: { entityId: string }) => i.entityId)).not.toContain(row.id);
  });

  it("a CSV import is previewed, refuses a file with bad lines, and importing the same file twice adds nothing", async () => {
    const d1 = addDays(today, -5);
    const d2 = addDays(today, -4);
    const csv = [`Day,Campaign name,Campaign ID,Amount spent (USD),Impressions,Link clicks`, `${d1},"Attar, launch",900111,5.18,1200,40`, `${d2},"Attar, launch",900111,7.61,1500,52`].join("\n");
    const bad = await api().post("/ads/import-csv", { financialAccountId: adAccount, csv: `${csv}\n${d2},"Attar, launch",900111,1,1,1`, commit: true });
    expect(bad.status).toBe(400);
    expect(await prisma.adCampaign.count({ where: { externalId: "900111" } })).toBe(0); // all or nothing
    const preview = await api().post("/ads/import-csv", { financialAccountId: adAccount, csv, commit: false });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({ committed: false, rows: 2, new: 2, newCampaigns: ["Attar, launch"], total: 1560.38, estimated: 2 });
    const before = await balanceOf("expense.advertising");
    const done = await api().post("/ads/import-csv", { financialAccountId: adAccount, csv, commit: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(await balanceOf("expense.advertising")).toBe(Math.round((before + 1560.38) * 100) / 100);
    const again = await api().post("/ads/import-csv", { financialAccountId: adAccount, csv, commit: true });
    expect(again.body).toMatchObject({ new: 0, same: 2, replace: 0 });
    expect(await balanceOf("expense.advertising")).toBe(Math.round((before + 1560.38) * 100) / 100);
    const c = await prisma.adCampaign.findFirstOrThrow({ where: { externalId: "900111" }, include: { spendDays: true } });
    expect(c.spendDays.map((d) => d.clicks).sort()).toEqual([40, 52]);
  });
});

describe("expense awaiting allocation", () => {
  let expenseId = "";
  it("a van hired for several errands is paid into 6990 and split later; the parts never exceed it", async () => {
    const e = await api().post("/expenses", { expenseDate: addDays(today, -1), expenseAccountId: acc["6990"], amount: 10000, costBehaviour: "VARIABLE", description: "Vehicle rental — several errands", fromFinancialAccountId: bank }, `van-${RUN}`);
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    expenseId = e.body.expense?.id ?? e.body.id;
    expect(await balanceOf("expense.unallocated")).toBe(10000);
    const product = await createStockedProduct({ stocks: [1], basePrice: 900 });
    const over = await api().put(`/center/allocations/${expenseId}`, { lines: [{ accountId: acc["6650"], amount: 6000 }, { accountId: acc["6900"], amount: 4500 }] });
    expect(over.status).toBe(400);
    expect(over.body.details.code).toBe("ALLOCATION_EXCEEDS");
    const part = await api().put(`/center/allocations/${expenseId}`, { lines: [{ accountId: acc["6650"], productId: product.product.id, amount: 6000, note: "Cap pickup" }] });
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    expect(part.body).toMatchObject({ allocated: 6000, remaining: 4000, status: "PARTLY_ALLOCATED" });
    expect(await balanceOf("expense.unallocated")).toBe(4000);
    expect(await balanceOf(acc["6650"]!)).toBe(6000);
    // the split is restated, never added on top: total expense stays 10,000
    const full = await api().put(`/center/allocations/${expenseId}`, { lines: [{ accountId: acc["6650"], productId: product.product.id, amount: 7000 }, { accountId: acc["6900"], amount: 3000 }] });
    expect(full.body.status).toBe("ALLOCATED");
    expect(await balanceOf("expense.unallocated")).toBe(0);
    expect((await balanceOf(acc["6650"]!)) + (await balanceOf(acc["6900"]!))).toBe(10000);
    const list = await api().get("/center/allocations");
    expect(list.body.expenses.find((x: { id: string }) => x.id === expenseId)).toMatchObject({ amount: 10000, allocated: 10000, remaining: 0 });
  });

  it("only an expense paid into the awaiting account is split", async () => {
    const e = await api().post("/expenses", { expenseDate: addDays(today, -1), expenseAccountId: acc["6900"], amount: 100, costBehaviour: "VARIABLE", description: "Tape", fromFinancialAccountId: bank }, `tape-${RUN}`);
    const r = await api().put(`/center/allocations/${e.body.expense?.id ?? e.body.id}`, { lines: [{ accountId: acc["6650"], amount: 50 }] });
    expect(r.status).toBe(409);
  });

  it("the database refuses parts above the expense even outside the service", async () => {
    await expect(
      prisma.expenseAllocation.create({ data: { expenseId, lineNo: 99, accountId: acc["6900"]!, amount: 1 } }),
    ).rejects.toThrow(/exceed/);
  });
});

describe("subscriptions, SMS and verification", () => {
  it("a domain paid for a year reminds before it ends and is renewed by the next year's payment", async () => {
    const end = addDays(today, 20);
    const p = await api().post("/prepaid", { name: `Domain ${RUN}`, expenseAccountId: acc["6400"], amount: 1464, serviceStart: addDays(end, -364), serviceEnd: end, fromFinancialAccountId: bank, paidOn: "2026-09-01", remindDaysBefore: 30, renewalAmount: 1500 }, `dom-${RUN}`);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    let r = (await api().get("/center/renewals")).body.renewals.find((x: { name: string }) => x.name === `Domain ${RUN}`);
    expect(r).toMatchObject({ status: "RENEW_SOON", renewalAmount: 1500, daysToEnd: 20 });
    const alerts = await api().get("/alerts");
    expect(alerts.body.alerts.map((a: { key: string }) => a.key)).toContain("subscriptions.renew");
    await api().post("/prepaid", { name: `Domain ${RUN}`, expenseAccountId: acc["6400"], amount: 1500, serviceStart: addDays(end, 1), serviceEnd: addDays(end, 365), fromFinancialAccountId: bank, paidOn: today }, `dom2-${RUN}`);
    r = (await api().get("/center/renewals")).body.renewals.filter((x: { name: string }) => x.name === `Domain ${RUN}`);
    expect(r.map((x: { status: string }) => x.status)).toEqual(["RENEWED", "ACTIVE"]);
  });

  it("SMS usage comes from balance readings and recharges; a low balance warns", async () => {
    await api().patch("/center/settings", { smsLowBalance: 300 });
    const t0 = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const t1 = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const t2 = new Date(Date.now() - 60_000).toISOString();
    for (const [balance, takenAt] of [[1500, t0], [1000, t1]] as const) expect((await api().post("/center/sms/balance", { balance, takenAt })).status).toBe(201);
    // a 2,000 recharge between the second and third reading
    const rechargeDay = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    expect((await api().post("/expenses", { expenseDate: rechargeDay, expenseAccountId: acc["6410"], amount: 2000, costBehaviour: "VARIABLE", description: "SMS recharge", fromFinancialAccountId: bank }, `sms-${RUN}`)).status).toBe(201);
    await api().post("/center/sms/balance", { balance: 250, takenAt: t2 });
    const s = (await api().get("/center/sms")).body;
    expect(s.balance).toBe(250);
    expect(s.isLow).toBe(true);
    expect(s.recharges.map((x: { amount: number }) => x.amount)).toEqual([2000]);
    // used: 1500→1000 = 500, then 1000 + 2000 → 250 = 2750
    expect(s.monthlyUsage.reduce((t: number, m: { used: number }) => t + m.used, 0)).toBe(3250);
    expect(s.provider.read).toBe(false); // no live provider in tests: the balance is typed in
    expect((await api().get("/alerts")).body.alerts.map((a: { key: string }) => a.key)).toContain("sms.low");
  });

  it("a reported figure is marked and listed until checked; the summary shows it and what is missing", async () => {
    const e = await api().post("/expenses", { expenseDate: addDays(today, -2), expenseAccountId: acc["6900"], amount: 2270, costBehaviour: "VARIABLE", description: "Stickers (owner's list)", fromFinancialAccountId: bank }, `stk-${RUN}`);
    const id = e.body.expense?.id ?? e.body.id;
    const set = await api().put("/center/verifications", { entityType: "Expense", entityId: id, status: "NEEDS_CHECK", source: "Owner's list 2026-10-21" });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const sum = (await api().get("/center/summary")).body;
    expect(sum.verification.NEEDS_CHECK).toMatchObject({ count: 1, amount: 2270 });
    expect(sum.missing.map((m: { key: string }) => m.key)).toContain("verification.needs_check");
    expect((await api().put("/center/verifications", { entityType: "Expense", entityId: id, status: "DISPUTED" })).status).toBe(400); // say what is disputed
    await api().put("/center/verifications", { entityType: "Expense", entityId: id, status: "CONFIRMED", source: "Supplier receipt" });
    expect((await api().get("/center/summary")).body.verification.NEEDS_CHECK).toBeUndefined();
    const audit = await prisma.financeAuditEntry.count({ where: { action: "verification.set", entityId: id } });
    expect(audit).toBe(2);
    expect((await api().put("/center/verifications", { entityType: "Expense", entityId: "nope", status: "ESTIMATED" })).status).toBe(404);
  });
});
