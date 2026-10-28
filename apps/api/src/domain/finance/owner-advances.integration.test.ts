import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { repayOwner } from "./owner-advances.service";

// Owner-advance subledger (blueprint P1.4, owner decision Q-F): what the owner paid from his own pocket to be repaid is a
// line each; "Repay owner" pays chosen lines with one withdrawal and links it to them. The ledger postings are treasury's.

const CSRF = "vitest-csrf";
let admin = "";
let OWNER: FinanceActor;
const api = () => {
  const cookie = [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`];
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
};
let seq = 0;
const key = (label: string) => `adv-${label}-${RUN}-${++seq}`;
const fa: Record<"pocket" | "bank" | "slowBank", string> = {} as never;
let acc: Record<string, string> = {};
const balance = async (id: string) => (await api().get(`/financial-accounts/${id}`)).body.currentBalance as number;
const advances = async () => (await api().get("/equity/owner/advances")).body as {
  lines: Array<{ id: string; description: string; sourceType: string; amount: number; repaid: number; outstanding: number }>;
  outstanding: number; ledgerBalance: number; unlinked: number;
};
const line = async (description: string) => (await advances()).lines.find((l) => l.description === description)!;
const ownerPaid = (description: string, amount: number, funding = "REIMBURSE") =>
  api().post("/expenses/owner-paid", { cashFinancialAccountId: fa.pocket, expenseAccountId: acc["6400"], amount, expenseDate: "2026-09-10", description, funding }, key("exp"));

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  expect((await api().get("/business")).status).toBe(200);
  expect((await api().patch("/business", { openingDate: "2026-09-01" })).status).toBe(200);
  const create = async (body: object) => {
    const r = await api().post("/financial-accounts", body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  fa.pocket = await create({ kind: "CASH", name: `Owner pocket ${RUN}` });
  fa.bank = await create({ kind: "BANK", name: `Bank ADV ${RUN}` });
  fa.slowBank = await create({ kind: "BANK", name: `Bank ADV approval ${RUN}`, approvalThreshold: 100 });
  acc = Object.fromEntries(((await api().get("/accounts")).body.accounts as Array<{ id: string; code: string }>).map((a) => [a.code, a.id]));
  await api().put("/opening-balances/lines", {
    lines: [
      { category: "BANK", financialAccountId: fa.bank, side: "DEBIT", amount: 50000 },
      { category: "BANK", financialAccountId: fa.slowBank, side: "DEBIT", amount: 10000 },
      { category: "CAPITAL", accountId: acc["3100"], side: "CREDIT", amount: 60000 },
    ],
  });
  expect((await api().post("/opening-balances/post")).status).toBe(200);
});

afterAll(async () => {
  await purgeFinanceTables();
});

describe("owed back to the owner, line by line (Q-F)", () => {
  it("an expense he paid to be repaid is a line; one he put in as capital is not; the lines explain the ledger", async () => {
    expect((await ownerPaid("Domain renewal", 1200)).status).toBe(201);
    expect((await ownerPaid("Printer ink", 800)).status).toBe(201);
    expect((await ownerPaid("Gift to the business", 500, "CAPITAL")).status).toBe(201);
    const a = await advances();
    expect(a.lines.map((l) => [l.description, l.sourceType, l.amount, l.outstanding])).toEqual([["Domain renewal", "Expense", 1200, 1200], ["Printer ink", "Expense", 800, 800]]);
    expect(a).toMatchObject({ outstanding: 2000, ledgerBalance: 2000, unlinked: 0 });
  });

  it("Repay owner pays chosen lines from one account and links the repayment to each; part of a line stays owed", async () => {
    const domain = await line("Domain renewal");
    const ink = await line("Printer ink");
    const bankBefore = await balance(fa.bank);
    const repayKey = key("repay");
    const r = await api().post("/equity/owner/repay", { fromFinancialAccountId: fa.bank, date: "2026-09-20", lines: [{ advanceId: domain.id, amount: 1200 }, { advanceId: ink.id, amount: 300 }] }, repayKey);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.movement).toMatchObject({ status: "POSTED", amount: 1500 });
    expect(await balance(fa.bank)).toBe(bankBefore - 1500);
    expect(await line("Domain renewal")).toMatchObject({ repaid: 1200, outstanding: 0 });
    expect(await line("Printer ink")).toMatchObject({ repaid: 300, outstanding: 500 });
    expect(await advances()).toMatchObject({ outstanding: 500, ledgerBalance: 500, unlinked: 0 });
    // the same request again repays nothing more
    const again = await api().post("/equity/owner/repay", { fromFinancialAccountId: fa.bank, date: "2026-09-20", lines: [{ advanceId: domain.id, amount: 1200 }, { advanceId: ink.id, amount: 300 }] }, repayKey);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(await prisma.ownerAdvanceAllocation.count()).toBe(2);
    expect(await balance(fa.bank)).toBe(bankBefore - 1500);
  });

  it("never more than a line still owes: refused before anything is written", async () => {
    const ink = await line("Printer ink");
    const movements = await prisma.treasuryMovement.count();
    const r = await api().post("/equity/owner/repay", { fromFinancialAccountId: fa.bank, lines: [{ advanceId: ink.id, amount: 501 }] }, key("over"));
    expect(r.status).toBe(409);
    expect(r.body.details).toMatchObject({ code: "REPAY_MORE_THAN_OWED", outstanding: 500 });
    expect(await prisma.treasuryMovement.count()).toBe(movements);
  });

  it("a repayment waiting for approval holds the line; rejecting it frees the line again", async () => {
    const ink = await line("Printer ink");
    const r = await api().post("/equity/owner/repay", { fromFinancialAccountId: fa.slowBank, lines: [{ advanceId: ink.id, amount: 500 }] }, key("slow"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.movement.status).toBe("PENDING_APPROVAL");
    expect(await line("Printer ink")).toMatchObject({ outstanding: 0 });
    // the ledger still owes him until it posts: the difference shows as unlinked, never hidden
    expect(await advances()).toMatchObject({ outstanding: 0, ledgerBalance: 500, unlinked: 500 });
    const second = await api().post("/equity/owner/repay", { fromFinancialAccountId: fa.bank, lines: [{ advanceId: ink.id, amount: 1 }] }, key("double"));
    expect(second.body.details?.code).toBe("REPAY_MORE_THAN_OWED");
    expect((await api().post(`/movements/${r.body.movement.id}/reject`, { reason: "paid him in cash instead" })).status).toBe(200);
    expect(await line("Printer ink")).toMatchObject({ repaid: 300, outstanding: 500 });
  });

  // Who may repay him is the route's gate (finance.sensitive): authorization.integration.test.ts lists it as owner-only.
  it("a line that doesn't exist is refused, nothing written", async () => {
    const movements = await prisma.treasuryMovement.count();
    await expect(repayOwner({ fromFinancialAccountId: fa.bank, lines: [{ advanceId: "c000000000000000000000000", amount: 1 }] }, OWNER, key("unknown"))).rejects.toMatchObject({ statusCode: 404, details: { code: "OWNER_ADVANCE_NOT_FOUND" } });
    expect(await prisma.treasuryMovement.count()).toBe(movements);
  });
});
