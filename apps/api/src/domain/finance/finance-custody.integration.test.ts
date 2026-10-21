import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";

// Owner's books §2 (docs/FINANCE_OWNER_BOOKS.md): who holds the money. The owner and a manager each hold a cash box; the
// manager hands cash to the owner (it waits until the owner confirms), counts their cash (a shortage waits for the owner),
// pays an expense from it; the owner pays one from their own pocket (owed back to them). The money map shows it all.

const CSRF = "vitest-csrf";
type Agent = ReturnType<typeof agent>;
function agent(adminId: string, role: "OWNER" | "STAFF") {
  const cookie = [`access_token=${signAccessToken({ adminId, role })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/v1/finance${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
    put: (url: string, body: object = {}) => auth(request(app).put(`/api/v1/finance${url}`)).send(body),
    patch: (url: string, body: object = {}) => auth(request(app).patch(`/api/v1/finance${url}`)).send(body),
  };
}

let owner: Agent;
let manager: Agent;
let ownerAdmin: string;
let managerAdmin: string;
const made: string[] = [];
const fa: Record<"ownerCash" | "managerCash" | "bank", string> = {} as never;
let acc: Record<string, string> = {};
let seq = 0;
const key = (label: string) => `custody-${label}-${RUN}-${++seq}`;
const balance = async (id: string) => (await owner.get(`/financial-accounts/${id}`)).body.currentBalance as number;

beforeAll(async () => {
  await purgeFinanceTables();
  ownerAdmin = await ownerId();
  owner = agent(ownerAdmin, "OWNER");
  const m = await prisma.adminUser.create({ data: { name: "Manager Rahim", email: `custody-mgr-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role: "STAFF" } });
  made.push(m.id);
  managerAdmin = m.id;
  manager = agent(m.id, "STAFF");
  expect((await owner.get("/business")).status).toBe(200);
  expect((await owner.patch("/business", { openingDate: "2026-09-01" })).status).toBe(200);
  const create = async (body: object) => {
    const r = await owner.post("/financial-accounts", body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  fa.ownerCash = await create({ kind: "CASH", name: `Cash — Owner ${RUN}` });
  fa.managerCash = await create({ kind: "CASH", name: `Cash — Manager ${RUN}` });
  fa.bank = await create({ kind: "BANK", name: `City Bank ${RUN}` });
  acc = Object.fromEntries(((await owner.get("/accounts")).body.accounts as Array<{ id: string; code: string }>).map((a) => [a.code, a.id]));
  await owner.put("/opening-balances/lines", {
    lines: [
      { category: "CASH", financialAccountId: fa.ownerCash, side: "DEBIT", amount: 10000 },
      { category: "CASH", financialAccountId: fa.managerCash, side: "DEBIT", amount: 5000 },
      { category: "BANK", financialAccountId: fa.bank, side: "DEBIT", amount: 50000 },
      { category: "CAPITAL", accountId: acc["3100"], side: "CREDIT", amount: 65000 },
    ],
  });
  expect((await owner.post("/opening-balances/post")).status).toBe(200);
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.auditLog.deleteMany({ where: { adminId: { in: made } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: made } } });
});

describe("custodians", () => {
  it("a cash box is somebody's; only cash has a custodian, and only an active team member", async () => {
    expect((await owner.put(`/financial-accounts/${fa.ownerCash}/custodian`, { custodianAdminId: ownerAdmin })).status).toBe(200);
    expect((await owner.put(`/financial-accounts/${fa.managerCash}/custodian`, { custodianAdminId: managerAdmin })).status).toBe(200);
    expect((await owner.put(`/financial-accounts/${fa.bank}/custodian`, { custodianAdminId: managerAdmin })).body.details?.code).toBe("CUSTODIAN_CASH_ONLY");
    expect((await owner.put(`/financial-accounts/${fa.ownerCash}/custodian`, { custodianAdminId: "nobody" })).body.details?.code).toBe("ADMIN_NOT_FOUND");
    expect((await manager.put(`/financial-accounts/${fa.managerCash}/custodian`, { custodianAdminId: managerAdmin })).status).toBe(403);
    const list = (await owner.get("/financial-accounts")).body.financialAccounts as Array<{ id: string; custodian: { id: string } | null }>;
    expect(list.find((a) => a.id === fa.managerCash)?.custodian?.id).toBe(managerAdmin);
  });

  it("the manager sees only the cash they hold — not the books", async () => {
    const me = (await manager.get("/custody/me")).body;
    expect(me.accounts).toEqual([{ id: fa.managerCash, name: `Cash — Manager ${RUN}`, balance: 5000 }]);
    expect(me.total).toBe(5000);
    expect(me.destinations.map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining([fa.ownerCash, fa.bank]));
    expect(me.expenseAccounts.some((a: { code: string }) => a.code === "6200")).toBe(false); // salaries are sensitive
    expect((await manager.get("/money-map")).status).toBe(403);
    expect((await manager.get("/financial-accounts")).status).toBe(403);
  });
});

describe("handovers", () => {
  it("cash handed to the owner waits until the owner confirms it reached them", async () => {
    const k = key("handover");
    const r = await manager.post("/custody/handovers", { fromFinancialAccountId: fa.managerCash, toFinancialAccountId: fa.ownerCash, amount: 2000, movementDate: "2026-09-10", description: "Day's COD cash" }, k);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.movement).toMatchObject({ kind: "TRANSFER", status: "PENDING_APPROVAL", receiverAdminId: ownerAdmin });
    expect((await manager.post("/custody/handovers", { fromFinancialAccountId: fa.managerCash, toFinancialAccountId: fa.ownerCash, amount: 2000, movementDate: "2026-09-10", description: "Day's COD cash" }, k)).body.replayed).toBe(true);
    expect(await balance(fa.managerCash)).toBe(5000);
    expect((await owner.get("/custody/me")).body.incoming.map((m: { id: string }) => m.id)).toEqual([r.body.movement.id]);
    // the manager can't confirm their own handover
    expect((await manager.post(`/custody/handovers/${r.body.movement.id}/confirm`)).body.details?.code).toBe("NOT_THE_RECEIVER");
    const c = await owner.post(`/custody/handovers/${r.body.movement.id}/confirm`);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.movement.status).toBe("POSTED");
    expect(await balance(fa.managerCash)).toBe(3000);
    expect(await balance(fa.ownerCash)).toBe(12000);
  });

  it("a handover into the manager's cash can't be approved by the owner in their place; a rejected one moves nothing", async () => {
    const r = await owner.post("/custody/handovers", { fromFinancialAccountId: fa.ownerCash, toFinancialAccountId: fa.managerCash, amount: 500, movementDate: "2026-09-11", description: "Float for deliveries" }, key("float"));
    expect(r.body.movement).toMatchObject({ status: "PENDING_APPROVAL", receiverAdminId: managerAdmin });
    expect((await owner.post(`/movements/${r.body.movement.id}/approve`)).body.details?.code).toBe("AWAITING_RECEIVER");
    expect((await manager.post(`/custody/handovers/${r.body.movement.id}/reject`, { reason: "Never received it" })).body.status).toBe("REJECTED");
    expect(await balance(fa.ownerCash)).toBe(12000);
    expect(await balance(fa.managerCash)).toBe(3000);
  });

  it("a person moves only the cash they hold", async () => {
    const r = await manager.post("/custody/handovers", { fromFinancialAccountId: fa.ownerCash, toFinancialAccountId: fa.managerCash, amount: 100, movementDate: "2026-09-11", description: "Taking cash" }, key("steal"));
    expect(r.status).toBe(403);
    expect(r.body.details?.code).toBe("NOT_YOUR_CASH");
  });

  it("depositing your cash into the bank waits for the owner (the bank has no holder to confirm it)", async () => {
    const r = await manager.post("/custody/handovers", { fromFinancialAccountId: fa.managerCash, toFinancialAccountId: fa.bank, amount: 1000, movementDate: "2026-09-12", description: "Deposited at City Bank" }, key("deposit"));
    expect(r.body.movement).toMatchObject({ status: "PENDING_APPROVAL", receiverAdminId: null });
    expect((await owner.post(`/movements/${r.body.movement.id}/approve`)).body.movement.status).toBe("POSTED");
    expect(await balance(fa.managerCash)).toBe(2000);
  });
});

describe("cash counts", () => {
  it("a shortage is recorded against cash over/short and waits for the owner; the count is history", async () => {
    const k = key("count");
    const r = await manager.post("/custody/cash-counts", { financialAccountId: fa.managerCash, countDate: "2026-09-12", counted: 1900, note: "Change given wrong" }, k);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.count).toMatchObject({ counted: 1900, expected: 2000, difference: -100, adjustment: { status: "PENDING_APPROVAL" } });
    expect((await manager.post("/custody/cash-counts", { financialAccountId: fa.managerCash, countDate: "2026-09-12", counted: 1900, note: "Change given wrong" }, k)).body.replayed).toBe(true);
    expect((await owner.post(`/movements/${r.body.count.adjustment.id}/approve`)).body.movement.status).toBe("POSTED");
    expect(await balance(fa.managerCash)).toBe(1900);
    const tb = (await owner.get("/trial-balance")).body;
    const shortRow = tb.rows.find((x: { code: string }) => x.code === "6970");
    expect(shortRow?.closingDebit ?? shortRow?.debit).toBe(100);
    await expect(prisma.cashCount.update({ where: { id: r.body.count.id }, data: { note: "edited" } })).rejects.toThrow(/immutable/);
  });

  it("a count that agrees records nothing to approve; a future count is refused", async () => {
    const r = await manager.post("/custody/cash-counts", { financialAccountId: fa.managerCash, countDate: "2026-09-13", counted: 1900 }, key("count-ok"));
    expect(r.body.count).toMatchObject({ difference: 0, adjustment: null });
    expect((await manager.post("/custody/cash-counts", { financialAccountId: fa.managerCash, countDate: "2099-01-01", counted: 1 }, key("future"))).body.details?.code).toBe("COUNT_IN_FUTURE");
    expect((await manager.post("/custody/cash-counts", { financialAccountId: fa.bank, countDate: "2026-09-13", counted: 1 }, key("bank"))).body.details?.code).toBe("COUNT_CASH_ONLY");
    expect((await manager.get("/custody/cash-counts")).body.counts).toHaveLength(2);
  });
});

describe("expenses from held cash and from the owner's pocket", () => {
  it("the manager pays packaging from their cash — it waits for the owner", async () => {
    const r = await manager.post("/custody/expenses", { fromFinancialAccountId: fa.managerCash, expenseAccountId: acc["6800"], amount: 400, expenseDate: "2026-09-14", description: "Poly bags", payee: "Chawkbazar" }, key("poly"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.expense.status).toBe("PENDING_APPROVAL");
    expect((await owner.post(`/movements/${r.body.expense.movementId}/approve`)).body.movement.status).toBe("POSTED");
    expect(await balance(fa.managerCash)).toBe(1500);
    expect((await manager.post("/custody/expenses", { fromFinancialAccountId: fa.ownerCash, expenseAccountId: acc["6800"], amount: 10, description: "x" }, key("x"))).body.details?.code).toBe("NOT_YOUR_CASH");
  });

  it("an expense paid from the owner's pocket is owed back to them; the cash account is unchanged", async () => {
    const before = await balance(fa.ownerCash);
    const r = await owner.post("/expenses/owner-paid", { cashFinancialAccountId: fa.ownerCash, expenseAccountId: acc["6400"], amount: 1200, expenseDate: "2026-09-15", description: "Domain renewal", funding: "REIMBURSE" }, key("domain"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.expense.status).toBe("POSTED");
    expect(r.body.funding.status).toBe("POSTED");
    expect(await balance(fa.ownerCash)).toBe(before);
    expect((await manager.post("/expenses/owner-paid", { cashFinancialAccountId: fa.ownerCash, expenseAccountId: acc["6400"], amount: 1, description: "x", funding: "REIMBURSE" }, key("y"))).status).toBe(403);
  });
});

describe("money map", () => {
  it("shows cash by person, banks, what is owed back to the owner — every figure a ledger balance", async () => {
    const m = (await owner.get("/money-map")).body;
    const person = (id: string) => m.cashByPerson.find((p: { custodian: { id: string } | null }) => p.custodian?.id === id)?.total;
    expect(person(ownerAdmin)).toBe(12000);
    expect(person(managerAdmin)).toBe(1500);
    expect(m.totals).toMatchObject({ cash: 13500, bank: 51000, ownerToRepay: 1200, courierReceivable: 0 });
    expect(m.equity).not.toBeNull();
    const checks = await owner.post("/reconciliation/run", { checks: ["ledger.integrity", "treasury.integrity"] });
    expect(checks.body.results.map((r: { status: string }) => r.status)).toEqual(["MATCHED", "MATCHED"]);
  });
});
