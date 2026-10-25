import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, ownerId, purgeFinanceTables } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances } from "./opening-balances.service";
import { createFinancialAccount } from "./financial-accounts.service";
import { commitExpenseImport, parseAmount, parseCsv, parseDate, previewExpenseImport } from "./expense-import.service";

// Expenses from a file (docs/FINANCE_EXPENSES.md §6): the owner's own history, nothing guessed, nothing recorded twice.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
let bkash = "";
const as = (r: request.Test) => r.set("Cookie", [`access_token=${signAccessToken({ adminId: admin, role: "OWNER" })}`, `csrf_token=${CSRF}`]).set("X-CSRF-Token", CSRF);

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-08-01", reason: "books start" }, OWNER);
  await postOpeningBalances(OWNER, { nothingHeld: true });
  bkash = `Shop bKash ${Date.now() % 100000}`;
  await createFinancialAccount({ kind: "MOBILE_WALLET", name: bkash, openingBalance: { amount: 10_000, date: "2026-08-01" } } as never, OWNER);
  await createFinancialAccount({ kind: "CASH", name: `Shop cash ${Date.now() % 100000}` } as never, OWNER);
}, 60_000);

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("reading the file", () => {
  it("dates, amounts (Bengali digits, ৳, commas) and quoted cells", () => {
    expect(parseDate("2026-09-05")).toBe("2026-09-05");
    expect(parseDate("05/09/2026")).toBe("2026-09-05");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseAmount("৳১,২৫০.৫০")).toBe(1250.5);
    expect(parseAmount("500 tk")).toBe(500);
    expect(parseAmount("-5")).toBeNull();
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
  });
});

describe("importing expenses", () => {
  const csv = () => [
    "date,category,amount,paid from,payee,description,reference",
    `2026-09-05,6410,500,${bkash},BulkSMSBD,SMS recharge,TRX1`,
    `12/10/2026,SMS,"1,000",owner,BulkSMSBD,SMS recharge,TRX2`,
    `2026-09-07,Coffee,120,${bkash},Cafe,coffee,`,
    `2026-07-15,6410,300,${bkash},BulkSMSBD,too early,`,
    `2026-09-08,6410,abc,${bkash},BulkSMSBD,bad amount,`,
  ].join("\n");

  it("preview: good rows, each problem named, nothing written", async () => {
    const before = await prisma.expense.count();
    const p = await previewExpenseImport(csv());
    expect(p.rows.map((r) => r.status)).toEqual(["OK", "OK", "PROBLEM", "PROBLEM", "PROBLEM"]);
    expect(p.rows[1]).toMatchObject({ date: "2026-10-12", amount: 1000, paidFrom: { kind: "OWNER", funding: "REIMBURSE" } });
    expect(p.rows[2]!.problem).toMatch(/no expense category "Coffee"/);
    expect(p.rows[3]!.problem).toMatch(/before the books start/);
    expect(p.rows[4]!.problem).toMatch(/isn't a positive amount/);
    expect(p.totals).toMatchObject({ ok: 2, problems: 3, amount: 1500 });
    expect(await prisma.expense.count()).toBe(before);
  });

  it("commit records the good rows; the same file again records nothing new and shows them as already recorded", async () => {
    const r = await commitExpenseImport({ csv: csv() }, OWNER);
    expect(r).toMatchObject({ recorded: 2, failed: 0, skipped: 3 });
    const sms = await prisma.expense.findMany({ where: { payee: "BulkSMSBD" }, orderBy: { expenseDate: "asc" } });
    expect(sms.map((e) => [e.expenseDate.toISOString().slice(0, 10), Number(e.amount), e.reference])).toEqual([["2026-09-05", 500, "TRX1"], ["2026-10-12", 1000, "TRX2"]]);
    // the owner's ৳1,000 is owed back to them (owner reimbursable), not taken from a shop account
    const again = await commitExpenseImport({ csv: csv() }, OWNER);
    expect(again.recorded).toBe(0);
    expect(await prisma.expense.count({ where: { payee: "BulkSMSBD" } })).toBe(2);
    const p = await previewExpenseImport(csv());
    expect(p.rows.slice(0, 2).map((x) => x.status)).toEqual(["DUPLICATE", "DUPLICATE"]);
  });

  it("over HTTP: a file without the needed columns is refused", async () => {
    const r = await as(request(app).post("/api/v1/finance/expenses/import/preview")).send({ csv: "when,how much\n2026-09-01,5" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/header row needs/);
  });
});
