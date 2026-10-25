import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS, addDays } from "@clothing-brand/shared";
import { app } from "../../app";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances } from "./opening-balances.service";

// Profit by day (docs/FINANCE_PROFIT_DASHBOARD.md): each business day's income statement in the owner's words — sales, and
// what the goods, packaging, delivery, payment fees, ads and running costs took — so the days add up to the books' net profit.

const CSRF = "vitest-csrf";
let admin = "";
const api = () => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}) => auth(request(app).post(`/api/v1/finance${url}`)).send(body),
  };
};
let today = "";
let cash = "";
let rent = "";
const key: Record<string, string> = {};

async function journal(entryDate: string, lines: Array<{ accountId: string; debit?: number; credit?: number; partyType?: string; partyId?: string }>) {
  const d = await api().post("/journals", { entryDate, description: `profit-daily ${RUN}`, lines });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  const p = await api().post(`/journals/${d.body.journal.id}/post`);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
}

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  const OWNER: FinanceActor = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureCommerceAccounting(OWNER);
  const { business } = await getFinanceContext();
  today = businessToday(business);
  await updateBusinessSettings({ openingDate: addDays(today, -40), reason: "test" }, OWNER);
  await postOpeningBalances(OWNER, { nothingHeld: true });
  for (const m of (await api().get("/mappings")).body.mappings as Array<{ key: string; account: { id: string } | null }>) if (m.account) key[m.key] = m.account.id;
  const accounts = (await api().get("/accounts")).body.accounts as Array<{ id: string; code: string; type: string; isPostable?: boolean }>;
  const c = await api().post("/financial-accounts", { kind: "CASH", name: `Cash box ${RUN}` });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  cash = c.body.ledgerAccount.id;
  const mapped = new Set(Object.values(key));
  rent = accounts.find((a) => a.type === "EXPENSE" && !mapped.has(a.id) && a.isPostable !== false)!.id;

  const d1 = addDays(today, -2);
  const d2 = addDays(today, -1);
  // Two delivered orders on d1: 1,000 + 500 of sales; goods 600, packaging 20, delivery 110, a gateway fee 15, ads 200.
  await journal(d1, [
    { accountId: cash, debit: 1500 },
    { accountId: key["revenue.merchandise"]!, credit: 1000, partyType: "Order", partyId: `o1-${RUN}` },
    { accountId: key["revenue.merchandise"]!, credit: 500, partyType: "Order", partyId: `o2-${RUN}` },
  ]);
  await journal(d1, [{ accountId: key["cogs.goods"]!, debit: 600 }, { accountId: key["cogs.packaging"]!, debit: 20 }, { accountId: cash, credit: 620 }]);
  await journal(d1, [{ accountId: key["expense.courier_fees"]!, debit: 110 }, { accountId: key["expense.gateway_fees"]!, debit: 15 }, { accountId: key["expense.advertising"]!, debit: 200 }, { accountId: cash, credit: 325 }]);
  // d2: no sales, ads 150 and the rent 300 — a loss day.
  await journal(d2, [{ accountId: key["expense.advertising"]!, debit: 150 }, { accountId: rent, debit: 300 }, { accountId: cash, credit: 450 }]);
  // A day in the prior period: 400 of sales.
  await journal(addDays(today, -10), [{ accountId: cash, debit: 400 }, { accountId: key["revenue.merchandise"]!, credit: 400, partyType: "Order", partyId: `o0-${RUN}` }]);
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("profit by day", () => {
  it("splits each day into sales and what it cost, and the days add up to the books' net profit", async () => {
    const from = addDays(today, -6);
    const r = await api().get(`/profit/daily?from=${from}&to=${today}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ period: { from, to: today }, prior: { from: addDays(today, -13), to: addDays(today, -7) }, today, booksStartedOn: addDays(today, -40) });
    // every day of the range is there, oldest first, quiet days as zero
    expect(r.body.days.map((d: { date: string }) => d.date)).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => addDays(from, i)));
    const d1 = r.body.days.find((d: { date: string }) => d.date === addDays(today, -2));
    expect(d1).toEqual({ date: addDays(today, -2), orders: 2, sales: 1500, goods: 600, stockCorrections: 0, packaging: 20, delivery: 110, paymentFees: 15, ads: 200, running: 0, salesProfit: 555, profit: 555 });
    const d2 = r.body.days.find((d: { date: string }) => d.date === addDays(today, -1));
    expect(d2).toMatchObject({ orders: 0, sales: 0, ads: 150, running: 300, profit: -450 });
    expect(r.body.days.find((d: { date: string }) => d.date === today)).toMatchObject({ sales: 0, profit: 0 });

    expect(r.body.totals).toMatchObject({ orders: 2, sales: 1500, goods: 600, packaging: 20, delivery: 110, paymentFees: 15, ads: 350, running: 300, profit: 105 });
    expect(r.body.totals.marginPct).toBe(7);
    // every taka of ads brought this much in sales
    expect(r.body.totals.salesPerAdTaka).toBeCloseTo(1500 / 350, 2);
    expect(r.body.priorTotals).toMatchObject({ orders: 1, sales: 400, profit: 400 });

    const statement = await api().get(`/statements/income?from=${from}&to=${today}`);
    expect(statement.status, JSON.stringify(statement.body)).toBe(200);
    expect(r.body.totals.profit).toBe(statement.body.current.netProfit);
  });

  it("defaults to the last 30 days and refuses a backwards or overlong range", async () => {
    const r = await api().get("/profit/daily");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.period).toEqual({ from: addDays(today, -29), to: today });
    expect(r.body.days).toHaveLength(30);
    expect((await api().get(`/profit/daily?from=${today}&to=${addDays(today, -1)}`)).status).toBe(400);
    expect((await api().get(`/profit/daily?from=${addDays(today, -400)}&to=${today}`)).status).toBe(400);
  });
});
