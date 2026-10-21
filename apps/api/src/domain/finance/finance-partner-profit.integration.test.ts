import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { monthEnd, monthsBetween, nextShare } from "./partner-profit.service";

// The owner and the partners (docs/FINANCE_EQUITY.md §8–§10): the owner's accounts are owner capital and drawings; a working
// partner gets a confirmed % of each finished month's profit, nothing in a loss month, a later change to a shared month
// arrives as a correction in the next share; paying never exceeds what is owed; the owner's money in and out is listed.

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
  };
};
let acc: Record<string, string> = {};
let bank = "";
let owner = "";
let mehedi = "";

async function journal(entryDate: string, debit: string, credit: string, amount: number, description: string) {
  const d = await api().post("/journals", { entryDate, description, lines: [{ accountId: debit, debit: amount, credit: 0 }, { accountId: credit, debit: 0, credit: amount }] });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  const p = await api().post(`/journals/${d.body.journal.id}/post`);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
}

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-08-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [1], basePrice: 100 });
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "OB-PP", name: "seed", quantity: 1, unitCost: 10, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-08-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  const b = await api().post("/financial-accounts", { kind: "BANK", name: `Bank PP ${RUN}` });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  bank = b.body.id;
  acc = Object.fromEntries(((await api().get("/accounts")).body.accounts as Array<{ id: string; code: string }>).map((a) => [a.code, a.id]));
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("the rules", () => {
  it("months, and a share with a loss month and a correction", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthEnd("2027-02")).toBe("2027-02-28");
    // a loss month: nothing; an earlier month now 1,000 higher: +200 (20%)
    const s = nextShare({ pct: 20, profitMinor: -300_000, earlier: [{ period: "2026-08", profitNowMinor: 1_100_000, creditedForPeriodMinor: 200_000 }], carriedMinor: 0, carriedFrom: null });
    expect(s).toMatchObject({ monthShare: 0, amount: 20_000, carried: 0 });
    // an earlier month now lower than shared: the next share is reduced, and a negative rest is carried, never taken back
    const t = nextShare({ pct: 20, profitMinor: 100_000, earlier: [{ period: "2026-08", profitNowMinor: 0, creditedForPeriodMinor: 200_000 }], carriedMinor: 0, carriedFrom: null });
    expect(t).toMatchObject({ monthShare: 20_000, amount: 0, carried: -180_000 });
  });
});

describe("the owner and a working partner", () => {
  it("the owner uses owner capital and drawings — once; the owner never takes a share", async () => {
    const r = await api().post("/equity/partners", { name: `Asif ${RUN}`, email: "owner@example.com", phone: "+8801000000000", joinedOn: "2026-08-01", role: "OWNER" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ role: "OWNER", capitalAccount: { code: "3100" }, currentAccount: { code: "3300" }, profitSharePct: null });
    owner = r.body.id;
    expect((await api().post("/equity/partners", { name: `Other ${RUN}`, joinedOn: "2026-08-01", role: "OWNER" })).status).toBe(409);
    expect((await api().patch(`/equity/partners/${owner}`, { profitSharePct: 10 })).status).toBe(400);
  });

  it("a working partner's 20% is confirmed when set", async () => {
    const r = await api().post("/equity/partners", { name: `Mehedi ${RUN}`, joinedOn: "2026-08-01", role: "WORKING", profitSharePct: 20, shareFrom: "2026-08-01", lossRule: "ZERO_IN_LOSS_MONTHS", shareConfirmedNote: "Owner, 2026-10-21" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ role: "WORKING", profitSharePct: 20, shareFrom: "2026-08-01", shareConfirmed: true });
    mehedi = r.body.id;
  });

  it("August earns 10,000 → 2,000; a later August sale arrives as a correction in September, a loss month", async () => {
    await journal("2026-08-15", bankLedger(), acc["4150"]!, 10_000, "August sales");
    const aug = await api().post("/equity/profit-shares/run", { through: "2026-08" });
    expect(aug.status, JSON.stringify(aug.body)).toBe(200);
    expect(aug.body.shared).toEqual([{ partner: `Mehedi ${RUN}`, period: "2026-08", amount: 2000 }]);
    expect((await api().post("/equity/profit-shares/run", { through: "2026-08" })).body.shared).toEqual([]);

    await journal("2026-08-30", bankLedger(), acc["4150"]!, 1_000, "late August sale");
    await journal("2026-09-10", acc["6100"]!, bankLedger(), 3_000, "September cost");
    const sep = await api().post("/equity/profit-shares/run", { through: "2026-09" });
    expect(sep.body.shared).toEqual([{ partner: `Mehedi ${RUN}`, period: "2026-09", amount: 200 }]);
    const o = (await api().get("/equity/profit-shares")).body.partners.find((p: { partnerId: string }) => p.partnerId === mehedi);
    expect(o.totals).toMatchObject({ earned: 2200, paid: 0, owed: 2200 });
    const septShare = o.shares.find((s: { period: string }) => s.period === "2026-09");
    expect(septShare).toMatchObject({ netProfit: -3000, monthShare: 0, amount: 200 });
    expect(septShare.corrections[0]).toMatchObject({ kind: "CHANGE", period: "2026-08", amount: 200 });
    await expect(prisma.profitShare.update({ where: { id: septShare.id }, data: { amount: 1 } })).rejects.toThrow(/never changed/);
  });

  it("paying: never more than owed; the activity lists shares and payments", async () => {
    await journal("2026-08-02", bankLedger(), acc["3100"]!, 5_000, "owner money for the test bank");
    expect((await api().post(`/equity/partners/${mehedi}/pay`, { fromFinancialAccountId: bank, amount: 2500, method: "BKASH" }, `pp-over-${RUN}`)).status).toBe(400);
    const pay = await api().post(`/equity/partners/${mehedi}/pay`, { fromFinancialAccountId: bank, amount: 1500, method: "BKASH", note: "October" }, `pp-pay-${RUN}`);
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    expect(pay.body.movement.status).toBe("POSTED");
    const a = (await api().get(`/equity/partners/${mehedi}/activity`)).body;
    expect(a.totals).toMatchObject({ credited: 2200, takenOut: 1500, current: 700 });
    expect(a.items.map((i: { kind: string }) => i.kind)).toEqual(["PAID", "PROFIT_SHARE", "PROFIT_SHARE"]);
    expect((await api().post(`/equity/partners/${owner}/pay`, { fromFinancialAccountId: bank, amount: 1, method: "CASH" }, `pp-owner-${RUN}`)).status).toBe(400);
  });

  it("the owner's money in and out", async () => {
    expect((await api().post("/equity/owner/money", { kind: "INVEST", financialAccountId: bank, amount: 50_000, date: "2026-08-05", method: "BANK" }, `om-in-${RUN}`)).status).toBe(201);
    expect((await api().post("/equity/owner/money", { kind: "WITHDRAW", financialAccountId: bank, amount: 4_000, date: "2026-09-01", method: "BKASH", note: "family" }, `om-out-${RUN}`)).status).toBe(201);
    const a = (await api().get(`/equity/partners/${owner}/activity`)).body;
    expect(a.totals).toMatchObject({ putIn: 55_000, takenOut: 4_000 });
    expect(a.items[0]).toMatchObject({ kind: "TAKEN_OUT", amount: -4000, date: "2026-09-01" });
    expect((await api().get("/equity/owner/payouts")).status).toBe(200);
    expect((await api().post("/equity/owner/payouts-taken", { settlementIds: ["nope"] })).status).toBe(404);
  });
});

let bankLedgerId = "";
function bankLedger() {
  return bankLedgerId;
}
beforeAll(async () => {
  const fa = await prisma.financialAccount.findUniqueOrThrow({ where: { id: bank }, select: { ledgerAccountId: true } });
  bankLedgerId = fa.ledgerAccountId;
});
