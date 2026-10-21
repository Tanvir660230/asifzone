import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances } from "./opening-balances.service";

// The owner's home (docs/FINANCE_OWNER_HOME.md): one call answers how the month went, where the money is, who is owed what
// and what needs doing — from the same books every other page reads.

const CSRF = "vitest-csrf";
let admin = "";
const as = (role: "OWNER" | "STAFF", id = admin) => {
  const cookie = [`access_token=${signAccessToken({ adminId: id, role })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/v1/finance${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
  };
};
let today = "";
let cash = "";
let packaging = "";

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  const OWNER: FinanceActor = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureCommerceAccounting(OWNER);
  const { business } = await getFinanceContext();
  today = businessToday(business);
  await updateBusinessSettings({ openingDate: `${today.slice(0, 7)}-01`, reason: "test" }, OWNER);
  await postOpeningBalances(OWNER, { nothingHeld: true });
  const c = await as("OWNER").post("/financial-accounts", { kind: "CASH", name: `Cash box ${RUN}` });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  cash = c.body.id;
  packaging = ((await as("OWNER").get("/accounts")).body.accounts as Array<{ id: string; code: string }>).find((a) => a.code === "6800")!.id;
  expect((await as("OWNER").post("/equity/partners", { name: `Owner ${RUN}`, joinedOn: today, role: "OWNER" })).status).toBe(201);
  expect((await as("OWNER").post("/equity/partners", { name: `Worker ${RUN}`, joinedOn: today, role: "WORKING", profitSharePct: 20 })).status).toBe(201);
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("the owner's home", () => {
  it("a cost the owner paid shows as money he put in, in the month's other costs, and as a loss nobody shares", async () => {
    const e = await as("OWNER").post("/expenses/owner-paid", { cashFinancialAccountId: cash, expenseAccountId: packaging, amount: 2000, expenseDate: today, description: "Poly bags", funding: "CAPITAL" }, `oh-${RUN}`);
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    const h = await as("OWNER").get("/owner-home");
    expect(h.status, JSON.stringify(h.body)).toBe(200);
    expect(h.body).toMatchObject({ booksStarted: true, month: { month: today.slice(0, 7), sales: 0, goods: 0, other: 2000, profit: -2000 } });
    expect(h.body.money.withUs.total).toBe(0);
    expect(h.body.people.owner).toMatchObject({ putIn: 2000, takenOut: 0, inBusiness: 2000 });
    expect(h.body.people.partners[0]).toMatchObject({ name: `Worker ${RUN}`, sharePct: 20, owed: 0, runningMonth: { profitSoFar: -2000, shareSoFar: 0 } });
    expect(h.body.todo).toEqual([]);
  });

  it("the owner taking money out shows on his card; a month can be asked for", async () => {
    expect((await as("OWNER").post("/equity/owner/money", { kind: "INVEST", financialAccountId: cash, amount: 500, date: today }, `oh-in-${RUN}`)).status).toBe(201);
    expect((await as("OWNER").post("/equity/owner/money", { kind: "WITHDRAW", financialAccountId: cash, amount: 300, date: today }, `oh-out-${RUN}`)).status).toBe(201);
    const h = (await as("OWNER").get("/owner-home")).body;
    expect(h.people.owner).toMatchObject({ putIn: 2500, takenOut: 300, inBusiness: 2200 });
    expect(h.money.withUs.total).toBe(200);
    expect((await as("OWNER").get("/owner-home?month=2026-1")).status).toBe(400);
  });
});
