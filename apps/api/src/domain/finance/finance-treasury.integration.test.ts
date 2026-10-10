import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import { financeTransaction } from "./finance-tx";

// Financial Core Phase 2 (docs/FINANCE_PHASE_2.md §9): cash, bank, wallets, transfers, statement lines, CSV import,
// matching and bank reconciliation — against the real database. One August of a small business:
//   opening (1 Jul): cash 10,000 · City Bank 50,000 · capital 60,000; Bank B opened 15 Jul with 20,000.
//   August: deposits, withdrawals, transfers between bank / cash / bKash, an approval, a rejection, a reversal, then the
//   City Bank statement is imported, matched and reconciled (a bank charge and interest resolved by explicit adjustments,
//   a deposit in transit left outstanding).

const CSRF = "vitest-csrf";
type Agent = ReturnType<typeof agent>;
function agent(adminId: string | null, role: "OWNER" | "STAFF" = "OWNER") {
  const cookie = adminId ? [`access_token=${signAccessToken({ adminId, role })}`, `csrf_token=${CSRF}`] : [`csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/v1/finance${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
    patch: (url: string, body: object = {}) => auth(request(app).patch(`/api/v1/finance${url}`)).send(body),
    put: (url: string, body: object = {}) => auth(request(app).put(`/api/v1/finance${url}`)).send(body),
    delete: (url: string) => auth(request(app).delete(`/api/v1/finance${url}`)),
  };
}

let owner: Agent;
let owner2: Agent;
const made: string[] = [];
let acc: Record<string, string> = {};
const fa: Record<"cash" | "bankA" | "bankB" | "bkash" | "gateway", { id: string; ledgerAccount: { id: string } }> = {} as never;
let seq = 0;
const key = (label: string) => `p2-${label}-${RUN}-${++seq}`;

async function balance(id: string): Promise<number> {
  return (await owner.get(`/financial-accounts/${id}`)).body.currentBalance;
}
async function move(kind: string, body: object, k = key(kind), who: Agent = owner) {
  return who.post(`/movements/${kind}`, { movementDate: "2026-08-01", description: `${kind} test`, ...body }, k);
}
async function makeAdmin(role: "OWNER" | "STAFF", tag: string) {
  const a = await prisma.adminUser.create({ data: { name: `Fin2 ${tag}`, email: `fin2-${tag}-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role } });
  made.push(a.id);
  return a.id;
}

beforeAll(async () => {
  await purgeFinanceTables();
  owner = agent(await ownerId());
  owner2 = agent(await makeAdmin("OWNER", "owner2"));
  expect((await owner.get("/business")).status).toBe(200);
  acc = Object.fromEntries(((await owner.get("/accounts")).body.accounts as Array<{ id: string; code: string }>).map((a) => [a.code, a.id]));
  expect((await owner.patch("/business", { openingDate: "2026-07-01" })).status).toBe(200);
  const create = async (body: object) => {
    const r = await owner.post("/financial-accounts", body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  fa.cash = await create({ kind: "CASH", name: "Cash box" });
  fa.bankA = await create({ kind: "BANK", name: "City Bank current", provider: "City Bank", accountTitle: "Asif Zone Ltd", branch: "Gulshan", accountReference: "****1234", metadata: { routingNumber: "225261725" } });
  fa.bkash = await create({ kind: "MOBILE_WALLET", name: "bKash merchant", provider: "bKash", accountReference: "01700000000" });
  fa.gateway = await create({ kind: "PAYMENT_GATEWAY", name: "SSLCommerz settlement", provider: "SSLCommerz", metadata: { storeId: "asifzone_live" } });
  await owner.put("/opening-balances/lines", {
    lines: [
      { category: "CASH", financialAccountId: fa.cash.id, side: "DEBIT", amount: 10000 },
      { category: "BANK", financialAccountId: fa.bankA.id, side: "DEBIT", amount: 50000 },
      { category: "CAPITAL", accountId: acc["3100"], side: "CREDIT", amount: 60000 },
    ],
  });
  expect((await owner.post("/opening-balances/post")).status).toBe(200);
});

afterAll(async () => {
  await purgeFinanceTables();
  await prisma.auditLog.deleteMany({ where: { adminId: { in: made } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: made } } });
});

describe("financial accounts (one account system — Phase 1 accounts with Phase 2 details)", () => {
  it("bank details, wallet and gateway accounts; balances are the ledger's, opening balances come from posted journals", async () => {
    const list = (await owner.get("/financial-accounts")).body.financialAccounts as Array<Record<string, unknown>>;
    const bank = list.find((a) => a.id === fa.bankA.id)!;
    expect(bank).toMatchObject({ kind: "BANK", accountTitle: "Asif Zone Ltd", branch: "Gulshan", accountReference: "****1234", status: "ACTIVE", currency: "BDT", openingBalance: 50000, currentBalance: 50000 });
    expect(bank.metadata).toEqual({ routingNumber: "225261725" });
    expect(list.find((a) => a.id === fa.cash.id)).toMatchObject({ openingBalance: 10000, currentBalance: 10000 });
    expect(list.find((a) => a.id === fa.gateway.id)).toMatchObject({ kind: "PAYMENT_GATEWAY", currentBalance: 0 });
    const ledger = (await owner.get(`/financial-accounts/${fa.bankA.id}/ledger`)).body;
    expect(ledger.closingBalance).toBe(50000);
  });

  it("credentials are never stored", async () => {
    const r = await owner.post("/financial-accounts", { kind: "BANK", name: `Leaky ${RUN}`, metadata: { password: "hunter2" } });
    expect(r.status).toBe(400);
    expect(await prisma.financialAccount.count({ where: { name: `Leaky ${RUN}` } })).toBe(0);
  });

  it("an account opened after the books started is funded by an opening-funding movement — above its threshold it waits for a second person", async () => {
    const r = await owner.post("/financial-accounts", { kind: "BANK", name: "Bank B savings", approvalThreshold: 10000, openingBalance: { amount: 20000, date: "2026-07-15" } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    fa.bankB = r.body;
    expect(r.body.openingMovement).toMatchObject({ kind: "OPENING_FUNDING", status: "PENDING_APPROVAL", amount: 20000 });
    expect(r.body.currentBalance).toBe(0);
    const same = await owner.post(`/movements/${r.body.openingMovement.id}/approve`);
    expect(same.body.details.code).toBe("SAME_PERSON_APPROVAL");
    const approved = await owner2.post(`/movements/${r.body.openingMovement.id}/approve`);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.movement).toMatchObject({ status: "POSTED", approvedByAdminId: made[0] });
    expect(await balance(fa.bankB.id)).toBe(20000);
    expect((await owner.get(`/financial-accounts/${fa.bankB.id}`)).body.openingBalance).toBe(20000);
    const again = await move("opening-funding", { financialAccountId: fa.bankB.id, amount: 5 });
    expect(again.body.details.code).toBe("OPENING_FUNDING_EXISTS");
  });
});

describe("cash management", () => {
  it("deposit: idempotent per Idempotency-Key; a different request under the key is refused; no key, no movement", async () => {
    const k = key("dep");
    const first = await move("deposit", { toFinancialAccountId: fa.cash.id, counterAccountId: acc["3100"], amount: 5000, movementDate: "2026-08-02", reference: "Owner top-up" }, k);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.movement).toMatchObject({ kind: "DEPOSIT", status: "POSTED" });
    const replay = await move("deposit", { toFinancialAccountId: fa.cash.id, counterAccountId: acc["3100"], amount: 5000, movementDate: "2026-08-02", reference: "Owner top-up" }, k);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true, movement: { id: first.body.movement.id } });
    expect((await move("deposit", { toFinancialAccountId: fa.cash.id, counterAccountId: acc["3100"], amount: 5001, movementDate: "2026-08-02" }, k)).body.details.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const noKey = await owner.post("/movements/deposit", { toFinancialAccountId: fa.cash.id, counterAccountId: acc["3100"], amount: 1, movementDate: "2026-08-02", description: "x" });
    expect(noKey.body.details.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(await balance(fa.cash.id)).toBe(15000);
    const journal = (await owner.get(`/journals/${first.body.movement.journalEntryId}`)).body;
    expect(journal).toMatchObject({ kind: "TREASURY", status: "POSTED", sourceType: "TreasuryMovement", sourceId: first.body.movement.id, totalDebit: 5000 });
  });

  it("withdrawal and adjustment; cash can't go below zero; counter accounts are never revenue, COGS or another money account", async () => {
    expect((await move("withdrawal", { fromFinancialAccountId: fa.cash.id, counterAccountId: acc["3300"], amount: 2000, movementDate: "2026-08-03" })).status).toBe(201);
    const adj = await move("adjustment", { financialAccountId: fa.cash.id, direction: "IN", counterAccountId: acc["7900"], amount: 100, movementDate: "2026-08-03", reason: "cash count surplus" });
    expect(adj.status, JSON.stringify(adj.body)).toBe(201);
    expect(await balance(fa.cash.id)).toBe(13100);
    const over = await move("withdrawal", { fromFinancialAccountId: fa.cash.id, counterAccountId: acc["3300"], amount: 99999 });
    expect(over.body.details.code).toBe("INSUFFICIENT_FUNDS");
    expect((await move("deposit", { toFinancialAccountId: fa.cash.id, counterAccountId: acc["4100"], amount: 10 })).body.details.code).toBe("COUNTER_ACCOUNT_TYPE");
    expect((await move("deposit", { toFinancialAccountId: fa.cash.id, counterAccountId: acc["5100"], amount: 10 })).body.details.code).toBe("COUNTER_ACCOUNT_TYPE");
    expect((await move("deposit", { toFinancialAccountId: fa.cash.id, counterAccountId: fa.bankA.ledgerAccount.id, amount: 10 })).body.details.code).toBe("COUNTER_IS_MONEY_ACCOUNT");
    expect(await balance(fa.cash.id)).toBe(13100);
  });
});

describe("transfers", () => {
  it("bank → cash, bank → bKash, bKash → bank, cash → bank: one balanced journal each, money accounts only — no revenue, no expense", async () => {
    const t1 = await move("transfer", { fromFinancialAccountId: fa.bankA.id, toFinancialAccountId: fa.cash.id, amount: 4000, movementDate: "2026-08-05", reference: "T1" });
    expect(t1.status, JSON.stringify(t1.body)).toBe(201);
    expect((await move("transfer", { fromFinancialAccountId: fa.bankA.id, toFinancialAccountId: fa.bkash.id, amount: 3000, movementDate: "2026-08-10" })).status).toBe(201);
    expect((await move("transfer", { fromFinancialAccountId: fa.bkash.id, toFinancialAccountId: fa.bankA.id, amount: 1000, movementDate: "2026-08-12" })).status).toBe(201);
    expect((await move("transfer", { fromFinancialAccountId: fa.cash.id, toFinancialAccountId: fa.bankA.id, amount: 700, movementDate: "2026-08-30", reference: "Deposit slip 88" })).status).toBe(201);
    expect(await balance(fa.bankA.id)).toBe(44700);
    expect(await balance(fa.cash.id)).toBe(16400);
    expect(await balance(fa.bkash.id)).toBe(2000);
    const lines = (await owner.get(`/journals/${t1.body.movement.journalEntryId}`)).body.lines as Array<{ accountId: string; debit: number; credit: number }>;
    expect(lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([[fa.cash.ledgerAccount.id, 4000, 0], [fa.bankA.ledgerAccount.id, 0, 4000]]);
    const types = await prisma.ledgerAccount.findMany({ where: { lines: { some: { entry: { kind: "TREASURY", treasuryMovement: { kind: "TRANSFER" } } } } }, select: { type: true } });
    expect(new Set(types.map((t) => t.type))).toEqual(new Set(["ASSET"]));
  });

  it("the same transfer sent five times at once is one transfer", async () => {
    const k = key("concurrent");
    const before = await balance(fa.cash.id);
    const body = { fromFinancialAccountId: fa.cash.id, toFinancialAccountId: fa.bkash.id, amount: 100, movementDate: "2026-08-20" };
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => move("transfer", body, k)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.movement.id)).size).toBe(1);
    expect(await prisma.treasuryMovement.count({ where: { idempotencyKey: `request:${k}` } })).toBe(1);
    expect(await balance(fa.cash.id)).toBe(before - 100);
  });

  it("concurrent withdrawals can't overdraw a wallet between them", async () => {
    expect(await balance(fa.bkash.id)).toBe(2100);
    const results = await Promise.all([1, 2, 3].map(() => move("withdrawal", { fromFinancialAccountId: fa.bkash.id, counterAccountId: acc["3300"], amount: 1500, movementDate: "2026-08-21" })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.body.details?.code === "INSUFFICIENT_FUNDS")).toHaveLength(2);
    expect(await balance(fa.bkash.id)).toBe(600);
  });

  it("a transfer is reversed through its movement (mirror journal, idempotent); its journal can't be reversed behind the movement's back", async () => {
    const before = await balance(fa.cash.id);
    const t = await move("transfer", { fromFinancialAccountId: fa.cash.id, toFinancialAccountId: fa.gateway.id, amount: 300, movementDate: "2026-08-21" });
    expect(await balance(fa.cash.id)).toBe(before - 300);
    const direct = await owner.post(`/journals/${t.body.movement.journalEntryId}/reverse`, { reason: "behind its back" });
    expect(direct.body.details.code).toBe("JOURNAL_OWNED_BY_MOVEMENT");
    const rev = await owner.post(`/movements/${t.body.movement.id}/reverse`, { reason: "sent to the wrong account" });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect(rev.body.movement).toMatchObject({ status: "REVERSED", reversalReason: "sent to the wrong account" });
    expect((await owner.post(`/movements/${t.body.movement.id}/reverse`, { reason: "again" })).body).toMatchObject({ replayed: true });
    expect(await balance(fa.cash.id)).toBe(before);
    expect(await balance(fa.gateway.id)).toBe(0);
    const reversal = (await owner.get(`/journals/${rev.body.movement.reversalJournalEntryId}`)).body;
    expect(reversal).toMatchObject({ kind: "REVERSAL", reversesEntryId: t.body.movement.journalEntryId });
  });

  it("above the threshold a transfer waits for a second person; a rejected one moves nothing", async () => {
    const cashBefore = await balance(fa.cash.id);
    const big = await move("transfer", { fromFinancialAccountId: fa.bankB.id, toFinancialAccountId: fa.cash.id, amount: 15000, movementDate: "2026-08-15" });
    expect(big.body.movement.status).toBe("PENDING_APPROVAL");
    expect(await balance(fa.bankB.id)).toBe(20000);
    expect((await owner2.post(`/movements/${big.body.movement.id}/approve`)).body.movement.status).toBe("POSTED");
    expect(await balance(fa.bankB.id)).toBe(5000);
    expect(await balance(fa.cash.id)).toBe(cashBefore + 15000);

    const other = await move("transfer", { fromFinancialAccountId: fa.bankB.id, toFinancialAccountId: fa.cash.id, amount: 12000, movementDate: "2026-08-16" });
    const rejected = await owner2.post(`/movements/${other.body.movement.id}/reject`, { reason: "not agreed" });
    expect(rejected.body).toMatchObject({ status: "REJECTED", rejectionReason: "not agreed" });
    expect((await owner2.post(`/movements/${other.body.movement.id}/approve`)).body.details.code).toBe("MOVEMENT_NOT_PENDING");
    expect(await balance(fa.bankB.id)).toBe(5000);
    expect((await owner.get(`/movements?status=PENDING_APPROVAL`)).body.total).toBe(0);
  });

  it("the database keeps a movement immutable except its status", async () => {
    const m = await prisma.treasuryMovement.findFirstOrThrow({ where: { kind: "DEPOSIT", status: "POSTED" } });
    await expect(prisma.treasuryMovement.update({ where: { id: m.id }, data: { amount: 1 } })).rejects.toThrow(/immutable/);
    await expect(prisma.treasuryMovement.delete({ where: { id: m.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(prisma.treasuryMovement.update({ where: { id: m.id }, data: { status: "PENDING_APPROVAL" } })).rejects.toThrow(/can't go from POSTED/);
  });
});

describe("brand and business isolation", () => {
  it("transfers never cross brands; accounts of another business are invisible", async () => {
    const business = await prisma.financeBusiness.findFirstOrThrow({ where: { key: "main" } });
    const brand2 = await financeTransaction(async (tx) => {
      const b = await tx.financeBrand.create({ data: { businessId: business.id, key: `brand2-${RUN}`, name: "Second brand" } });
      await tx.financeAuditEntry.create({ data: { businessId: business.id, actorType: "SYSTEM", actorLabel: "test", action: "brand.create", entityType: "FinanceBrand", entityId: b.id } });
      return b;
    });
    const b2cash = await owner.post("/financial-accounts", { kind: "CASH", name: `Brand 2 cash ${RUN}`, brandId: brand2.id });
    expect(b2cash.status).toBe(201);
    const cross = await move("transfer", { fromFinancialAccountId: fa.cash.id, toFinancialAccountId: b2cash.body.id, amount: 10 });
    expect(cross.body.details.code).toBe("CROSS_BRAND_TRANSFER");
    const scoped = (await owner.get(`/financial-accounts?brandId=${brand2.id}`)).body.financialAccounts as Array<{ id: string }>;
    expect(scoped.map((a) => a.id)).toEqual([b2cash.body.id]);

    const foreign = await financeTransaction(async (tx) => {
      const other = await tx.financeBusiness.create({ data: { key: `other-${RUN}`, name: "Other business", baseCurrency: "BDT", timezone: "Asia/Dhaka" } });
      const la = await tx.ledgerAccount.create({ data: { businessId: other.id, code: "1101", name: "Other cash", type: "ASSET", normalBalance: "DEBIT" } });
      const f = await tx.financialAccount.create({ data: { businessId: other.id, kind: "CASH", name: "Other cash", currency: "BDT", ledgerAccountId: la.id } });
      await tx.financeAuditEntry.createMany({
        data: [
          { businessId: other.id, actorType: "SYSTEM", actorLabel: "test", action: "x", entityType: "FinanceBusiness", entityId: other.id },
          { businessId: other.id, actorType: "SYSTEM", actorLabel: "test", action: "x", entityType: "LedgerAccount", entityId: la.id },
          { businessId: other.id, actorType: "SYSTEM", actorLabel: "test", action: "x", entityType: "FinancialAccount", entityId: f.id },
        ],
      });
      return f;
    });
    expect((await owner.get(`/financial-accounts/${foreign.id}`)).status).toBe(404);
    expect((await move("deposit", { toFinancialAccountId: foreign.id, counterAccountId: acc["3100"], amount: 10 })).body.details.code).toBe("FINANCIAL_ACCOUNT_NOT_FOUND");
    expect((await owner.get("/financial-accounts")).body.financialAccounts.some((a: { id: string }) => a.id === foreign.id)).toBe(false);
  });
});

const AUGUST = [
  "City Bank PLC — Account statement ****1234",
  "Txn Date,Narration,Ref,Withdrawal,Deposit,Balance",
  "05/08/2026,Transfer to cash,T1,\"4,000.00\",,\"46,000.00\"",
  "10/08/2026,bKash transfer,BK-1,\"3,000.00\",,\"43,000.00\"",
  "12/08/2026,bKash inward,BK-2,,\"1,000.00\",\"44,000.00\"",
  "31/08/2026,Service charge,,150.00,,\"43,850.00\"",
  "31/08/2026,Interest,,,50.00,\"43,900.00\"",
].join("\r\n");
const MAPPING = { date: "Txn Date", description: "Narration", reference: "Ref", debit: "Withdrawal", credit: "Deposit", balance: "Balance" };
const OPTIONS = { dateFormat: "DD/MM/YYYY", hasHeader: true, skipRows: 1 };

describe("statement lines and CSV import", () => {
  it("previews, then imports a statement through a column mapping; the same file again is the same import", async () => {
    const body = { financialAccountId: fa.bankA.id, fileName: "city-aug.csv", csv: AUGUST, mapping: MAPPING, options: OPTIONS };
    const preview = await owner.post("/statement-imports/preview", body);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({ newRows: 5, duplicateRows: 0, errors: [] });
    const first = await owner.post("/statement-imports", body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.import).toMatchObject({ rowCount: 5, importedCount: 5, duplicateCount: 0, errorCount: 0 });
    const again = await owner.post("/statement-imports", body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ replayed: true, import: { id: first.body.import.id } });
    expect(await prisma.bankTransaction.count({ where: { financialAccountId: fa.bankA.id } })).toBe(5);
  });

  it("an overlapping export adds only the rows it hasn't seen — imports never create duplicates; imports and lines are immutable", async () => {
    const overlap = [AUGUST.split("\r\n")[1], ...AUGUST.split("\r\n").slice(4), "01/09/2026,Customer transfer,NPSB-7,,200.00,\"44,100.00\""].join("\n");
    const r = await owner.post("/statement-imports", { financialAccountId: fa.bankA.id, csv: overlap, mapping: MAPPING, options: { ...OPTIONS, skipRows: 0 } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.import).toMatchObject({ rowCount: 4, importedCount: 1, duplicateCount: 3 });
    expect(await prisma.bankTransaction.count({ where: { financialAccountId: fa.bankA.id } })).toBe(6);
    const imp = await prisma.statementImport.findFirstOrThrow({ where: { financialAccountId: fa.bankA.id } });
    await expect(prisma.statementImport.update({ where: { id: imp.id }, data: { importedCount: 0 } })).rejects.toThrow(/append-only/);
    const line = await prisma.bankTransaction.findFirstOrThrow({ where: { financialAccountId: fa.bankA.id } });
    await expect(prisma.bankTransaction.update({ where: { id: line.id }, data: { description: "edited" } })).rejects.toThrow(/evidence/);
    expect((await owner.delete(`/bank-transactions/${line.id}`)).body.details.code).toBe("BANK_LINE_HAS_HISTORY");
  });

  it("manual lines (a gateway settlement): idempotent by the bank's id or the Idempotency-Key", async () => {
    const body = { financialAccountId: fa.gateway.id, transactionDate: "2026-08-25", description: "Settlement batch 9", credit: 2500, externalId: `SSL-${RUN}` };
    const a = await owner.post("/bank-transactions", body);
    const b = await owner.post("/bank-transactions", body);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.bankTransaction.id).toBe(a.body.bankTransaction.id);
    expect((await owner.post("/bank-transactions", { ...body, credit: 2600 })).body.details.code).toBe("DUPLICATE_STATEMENT_LINE");
    const noKey = await owner.post("/bank-transactions", { financialAccountId: fa.gateway.id, transactionDate: "2026-08-25", description: "x", debit: 1 });
    expect(noKey.body.details.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    const typo = await owner.post("/bank-transactions", { financialAccountId: fa.gateway.id, transactionDate: "2026-08-26", description: "typo", debit: 9 }, key("typo"));
    expect((await owner.delete(`/bank-transactions/${typo.body.bankTransaction.id}`)).status).toBe(204);
    expect(await balance(fa.gateway.id)).toBe(0); // statement lines never post
  });
});

describe("matching", () => {
  const line = async (ref: string) => prisma.bankTransaction.findFirstOrThrow({ where: { financialAccountId: fa.bankA.id, OR: [{ reference: ref }, { description: ref }] } });
  const ledgerLine = async (movementRef: string | null, amount: number, side: "debit" | "credit") => {
    const lines = await prisma.journalLine.findMany({ where: { accountId: fa.bankA.ledgerAccount.id, entry: { status: "POSTED", kind: "TREASURY" } }, include: { entry: true } });
    return lines.find((l) => Number(l[side]) === amount && (movementRef === null || l.entry.reference === movementRef || l.memo === movementRef))!;
  };

  it("candidates put the exact amount first; a full match is MATCHED; unmatch keeps the history; concurrent matches can't double-match", async () => {
    const st = await line("T1");
    const t1 = await ledgerLine("T1", 4000, "credit");
    const cands = (await owner.get(`/bank-transactions/${st.id}/candidates`)).body.candidates as Array<{ journalLineId: string; exactAmount: boolean }>;
    expect(cands[0]).toMatchObject({ journalLineId: t1.id, exactAmount: true });
    const m = await owner.post(`/bank-transactions/${st.id}/match`, { journalLineId: t1.id });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    expect(m.body).toMatchObject({ status: "MATCHED", matchedAmount: 4000, unmatchedAmount: 0 });
    const un = await owner.post(`/bank-matches/${m.body.matches[0].id}/unmatch`, { reason: "wrong pairing, checking" });
    expect(un.body).toMatchObject({ status: "UNMATCHED", matchedAmount: 0 });
    expect(un.body.matches[0]).toMatchObject({ status: "REMOVED", removalReason: "wrong pairing, checking" });
    const racing = await Promise.all([1, 2].map(() => owner.post(`/bank-transactions/${st.id}/match`, { journalLineId: t1.id })));
    expect(racing.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: st.id } })).matchedAmount.toNumber()).toBe(4000);
  });

  it("partial matching, direction and over-matching are refused by the service and by the database", async () => {
    const st = await line("BK-1");
    const t2 = await ledgerLine(null, 3000, "credit");
    const part = await owner.post(`/bank-transactions/${st.id}/match`, { journalLineId: t2.id, amount: 1000 });
    expect(part.body).toMatchObject({ status: "PARTIALLY_MATCHED", matchedAmount: 1000, unmatchedAmount: 2000 });
    expect((await owner.post(`/bank-transactions/${st.id}/match`, { journalLineId: t2.id, amount: 1 })).body.details.code).toBe("ALREADY_MATCHED");
    const t1 = await ledgerLine("T1", 4000, "credit");
    expect((await owner.post(`/bank-transactions/${st.id}/match`, { journalLineId: t1.id })).body.details.code).toBe("NOTHING_TO_MATCH");
    const inward = await line("BK-2");
    expect((await owner.post(`/bank-transactions/${inward.id}/match`, { journalLineId: t2.id })).body.details.code).toBe("MATCH_DIRECTION");
    // Finish BK-1 through a removal + full re-match, leaving BK-2 for auto-match.
    await owner.post(`/bank-matches/${part.body.matches[0].id}/unmatch`, { reason: "redo as one" });
    expect((await owner.post(`/bank-transactions/${st.id}/match`, { journalLineId: t2.id })).body.status).toBe("MATCHED");
    const interest = await line("Interest");
    const t3 = await ledgerLine(null, 1000, "debit");
    await expect(
      financeTransaction(async (tx) => {
        const mm = await tx.bankTransactionMatch.create({ data: { businessId: interest.businessId, bankTransactionId: interest.id, journalLineId: t3.id, amount: 500 } });
        await tx.financeAuditEntry.create({ data: { actorType: "SYSTEM", actorLabel: "test", action: "x", entityType: "BankTransactionMatch", entityId: mm.id } });
      }),
    ).rejects.toThrow(/beyond its amount/);
    await expect(prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: st.id } })).rejects.toThrow(/never deleted/);
  });

  it("the matched amount is derived — a direct write can't make it drift", async () => {
    const st = await line("BK-1");
    await financeTransaction(async (tx) => {
      await tx.bankTransaction.update({ where: { id: st.id }, data: { matchedAmount: 1 } });
      await tx.financeAuditEntry.create({ data: { actorType: "SYSTEM", actorLabel: "test", action: "x", entityType: "BankTransaction", entityId: st.id } });
    });
    expect(await prisma.bankTransaction.findUniqueOrThrow({ where: { id: st.id } })).toMatchObject({ status: "MATCHED" });
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: st.id } })).matchedAmount.toNumber()).toBe(3000);
  });

  it("a line with no counterpart is flagged ADJUSTMENT_REQUIRED", async () => {
    const charge = await line("Service charge");
    const r = await owner.post(`/bank-transactions/${charge.id}/flag`, { adjustmentRequired: true, note: "bank fee — not in the books" });
    expect(r.body).toMatchObject({ status: "ADJUSTMENT_REQUIRED", note: "bank fee — not in the books" });
  });
});

describe("bank reconciliation", () => {
  let runId: string;

  it("starts from the statement's balances and reports the gap, the difference and what is unmatched", async () => {
    const r = await owner.post("/bank-reconciliations", { financialAccountId: fa.bankA.id, periodStart: "2026-08-01", periodEnd: "2026-08-31", openingStatementBalance: 50000, closingStatementBalance: 43900 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    runId = r.body.id;
    const d = (await owner.get(`/bank-reconciliations/${runId}`)).body;
    expect(d.live).toMatchObject({ statementGap: 0, ledgerOpeningBalance: 50000, ledgerBalance: 44700, difference: -800, unmatchedCount: 3, canComplete: false });
    expect(d.statementLines).toHaveLength(5);
    expect(d.outstandingLedgerLines.map((l: { remaining: number }) => l.remaining).sort()).toEqual([1000, 700].sort());
    expect((await owner.post(`/bank-reconciliations/${runId}/complete`, {})).body.details).toMatchObject({ code: "UNMATCHED_STATEMENT_LINES", unmatchedCount: 3 });
    expect((await owner.post("/bank-reconciliations", { financialAccountId: fa.bankA.id, periodStart: "2026-08-01", periodEnd: "2026-08-31", openingStatementBalance: 50000, closingStatementBalance: 43900 })).body.details.code).toBe("RECONCILIATION_IN_PROGRESS");
  });

  it("auto-match pairs the unambiguous line; the bank charge and the interest are resolved by explicit, journaled adjustments", async () => {
    expect((await owner.post(`/bank-reconciliations/${runId}/auto-match`)).body).toEqual({ matched: 1 });
    const charge = await prisma.bankTransaction.findFirstOrThrow({ where: { financialAccountId: fa.bankA.id, description: "Service charge" } });
    const interest = await prisma.bankTransaction.findFirstOrThrow({ where: { financialAccountId: fa.bankA.id, description: "Interest" } });
    const [audits, movements] = [await prisma.financeAuditEntry.count(), await prisma.treasuryMovement.count()];
    const bad = await owner.post(`/bank-transactions/${charge.id}/adjust`, { counterAccountId: acc["4100"], reason: "fee", reconciliationId: runId });
    expect(bad.body.details.code).toBe("COUNTER_ACCOUNT_TYPE");
    expect([await prisma.financeAuditEntry.count(), await prisma.treasuryMovement.count()]).toEqual([audits, movements]); // nothing half-done

    const a1 = await owner.post(`/bank-transactions/${charge.id}/adjust`, { counterAccountId: acc["8200"], reason: "Monthly service charge per statement", reconciliationId: runId });
    expect(a1.status, JSON.stringify(a1.body)).toBe(200);
    expect(a1.body.movement).toMatchObject({ kind: "ADJUSTMENT", direction: "OUT", status: "POSTED", amount: 150, bankTransactionId: charge.id });
    expect(a1.body.bankTransaction).toMatchObject({ status: "MATCHED", description: "Service charge", debit: 150 });
    const a1again = await owner.post(`/bank-transactions/${charge.id}/adjust`, { counterAccountId: acc["8200"], reason: "Monthly service charge per statement", reconciliationId: runId });
    expect(a1again.body.details.code).toBe("NOTHING_TO_ADJUST");
    const a2 = await owner.post(`/bank-transactions/${interest.id}/adjust`, { counterAccountId: acc["7100"], reason: "Interest credited", reconciliationId: runId });
    expect(a2.body.movement).toMatchObject({ direction: "IN", amount: 50 });
    expect(await balance(fa.bankA.id)).toBe(44600);
  });

  it("completes with a deposit in transit outstanding; the snapshot is history, the lines are final", async () => {
    const d = (await owner.get(`/bank-reconciliations/${runId}`)).body.live;
    expect(d).toMatchObject({ unmatchedCount: 0, difference: -700, outstandingLedgerNet: 700, unexplainedDifference: 0, canComplete: true });
    const done = await owner.post(`/bank-reconciliations/${runId}/complete`, { notes: "Deposit slip 88 in transit" });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({
      status: "COMPLETED", openingStatementBalance: 50000, closingStatementBalance: 43900, ledgerBalance: 44600, difference: -700, unexplainedDifference: 0,
      statementGap: 0, matchedCount: 5, unmatchedCount: 0, outstandingLedgerCount: 1, adjustmentCount: 2, notes: "Deposit slip 88 in transit",
    });
    expect(await prisma.bankTransaction.count({ where: { reconciliationId: runId, status: "RECONCILED" } })).toBe(5);
    const m = await prisma.bankTransactionMatch.findFirstOrThrow({ where: { bankTransaction: { reconciliationId: runId }, status: "ACTIVE" } });
    expect((await owner.post(`/bank-matches/${m.id}/unmatch`, { reason: "late change" })).body.details.code).toBe("BANK_LINE_RECONCILED");
    await expect(prisma.bankReconciliation.update({ where: { id: runId }, data: { notes: "rewritten" } })).rejects.toThrow(/history/);
    expect((await owner.get(`/financial-accounts/${fa.bankA.id}`)).body).toMatchObject({ reconciliationStartDate: "2026-08-01", lastReconciledThrough: "2026-08-31" });
  });

  it("the next run must chain on; an incomplete statement can't complete; abandoned runs stay in the history", async () => {
    const base = { financialAccountId: fa.bankA.id, periodEnd: "2026-09-30", closingStatementBalance: 44999 };
    expect((await owner.post("/bank-reconciliations", { ...base, periodStart: "2026-09-02", openingStatementBalance: 43900 })).body.details.code).toBe("RECONCILIATION_CHAIN");
    expect((await owner.post("/bank-reconciliations", { ...base, periodStart: "2026-09-01", openingStatementBalance: 43000 })).body.details.code).toBe("RECONCILIATION_CHAIN");
    const wrong = await owner.post("/bank-reconciliations", { ...base, periodStart: "2026-09-01", openingStatementBalance: 43900 });
    expect(wrong.status).toBe(201);
    expect((await owner.post(`/bank-reconciliations/${wrong.body.id}/complete`, {})).body.details).toMatchObject({ code: "STATEMENT_INCOMPLETE", statementGap: -899 });
    expect((await owner.post(`/bank-reconciliations/${wrong.body.id}/abandon`, { reason: "typed the closing balance wrong" })).body.status).toBe("ABANDONED");
    const right = await owner.post("/bank-reconciliations", { ...base, periodStart: "2026-09-01", openingStatementBalance: 43900, closingStatementBalance: 44100 });
    const live = (await owner.get(`/bank-reconciliations/${right.body.id}`)).body.live;
    expect(live).toMatchObject({ statementGap: 0, unmatchedCount: 1, unmatchedStatementNet: 200, outstandingLedgerNet: 700, unexplainedDifference: 0, canComplete: false });
    const history = (await owner.get(`/bank-reconciliations?financialAccountId=${fa.bankA.id}`)).body.reconciliations as Array<{ status: string }>;
    expect(history.map((h) => h.status).sort()).toEqual(["ABANDONED", "COMPLETED", "IN_PROGRESS"]);
    await owner.post(`/bank-reconciliations/${right.body.id}/abandon`, { reason: "September not closed yet" });
  });

  it("a difference nothing explains blocks completion — and is resolved by an explicit adjustment, never by overwriting the ledger", async () => {
    // Bank B: books 20,000 on 15 Jul, −15,000 on 15 Aug → 5,000. The bank says it opened August with 19,000.
    const out = await owner.post("/bank-transactions", { financialAccountId: fa.bankB.id, transactionDate: "2026-08-15", description: "Transfer to cash", debit: 15000 }, key("bankb"));
    const transferLine = await prisma.journalLine.findFirstOrThrow({ where: { accountId: fa.bankB.ledgerAccount.id, credit: 15000 } });
    expect((await owner.post(`/bank-transactions/${out.body.bankTransaction.id}/match`, { journalLineId: transferLine.id })).body.status).toBe("MATCHED");
    const run = await owner.post("/bank-reconciliations", { financialAccountId: fa.bankB.id, periodStart: "2026-08-01", periodEnd: "2026-08-31", openingStatementBalance: 19000, closingStatementBalance: 4000 });
    const ledgerBefore = await balance(fa.bankB.id);
    const blocked = await owner.post(`/bank-reconciliations/${run.body.id}/complete`, {});
    expect(blocked.body.details).toMatchObject({ code: "UNEXPLAINED_DIFFERENCE", difference: -1000, unexplainedDifference: 1000 });
    expect(await balance(fa.bankB.id)).toBe(ledgerBefore); // nothing was changed to make it fit
    const fix = await move("adjustment", { financialAccountId: fa.bankB.id, direction: "OUT", counterAccountId: acc["8900"], amount: 1000, movementDate: "2026-07-31", reason: "Opening balance per bank was 19,000" });
    expect(fix.status, JSON.stringify(fix.body)).toBe(201);
    const done = await owner.post(`/bank-reconciliations/${run.body.id}/complete`, { notes: "Opening difference adjusted" });
    expect(done.body).toMatchObject({ status: "COMPLETED", difference: 0, unexplainedDifference: 0 });
    expect(await prisma.journalEntry.count({ where: { id: fix.body.movement.journalEntryId, status: "POSTED" } })).toBe(1);
  });
});

describe("audit, permissions and ledger integrity", () => {
  it("every Phase 2 record has its financial audit entry; a change without one can't commit", async () => {
    const rows = await prisma.$queryRaw<Array<{ t: string; n: bigint }>>`
      SELECT 'TreasuryMovement' AS t, COUNT(*) AS n FROM "TreasuryMovement" x WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'TreasuryMovement' AND f."entityId" = x.id)
      UNION ALL SELECT 'BankTransaction', COUNT(*) FROM "BankTransaction" x WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'BankTransaction' AND f."entityId" = x.id)
      UNION ALL SELECT 'BankTransactionMatch', COUNT(*) FROM "BankTransactionMatch" x WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'BankTransactionMatch' AND f."entityId" = x.id)
      UNION ALL SELECT 'StatementImport', COUNT(*) FROM "StatementImport" x WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'StatementImport' AND f."entityId" = x.id)
      UNION ALL SELECT 'BankReconciliation', COUNT(*) FROM "BankReconciliation" x WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'BankReconciliation' AND f."entityId" = x.id)`;
    expect(rows.map((r) => [r.t, Number(r.n)])).toEqual([["TreasuryMovement", 0], ["BankTransaction", 0], ["BankTransactionMatch", 0], ["StatementImport", 0], ["BankReconciliation", 0]]);
    const m = await prisma.treasuryMovement.findFirstOrThrow({ where: { status: "PENDING_APPROVAL" } }).catch(() => null);
    expect(m).toBeNull();
    const pending = await move("transfer", { fromFinancialAccountId: fa.bankB.id, toFinancialAccountId: fa.cash.id, amount: 10000, movementDate: "2026-08-28" });
    await expect(financeTransaction((tx) => tx.treasuryMovement.update({ where: { id: pending.body.movement.id }, data: { status: "REJECTED", rejectionReason: "no audit" } }))).rejects.toMatchObject({ details: { code: "FINANCE_AUDIT_REQUIRED" } });
    expect((await prisma.treasuryMovement.findUniqueOrThrow({ where: { id: pending.body.movement.id } })).status).toBe("PENDING_APPROVAL");
    await owner2.post(`/movements/${pending.body.movement.id}/reject`, { reason: "tidy up" });
  });

  it("Phase 2 routes are OWNER-only: STAFF 403, anonymous 401", async () => {
    const staff = agent(await makeAdmin("STAFF", "staff"), "STAFF");
    for (const [method, url] of [["get", "/movements"], ["post", "/movements/transfer"], ["get", "/bank-transactions"], ["post", "/statement-imports"], ["post", "/bank-reconciliations"], ["get", `/financial-accounts/${fa.cash.id}`]] as const) {
      expect((await staff[method](url)).status, `${method} ${url}`).toBe(403);
      expect((await agent(null)[method](url)).status, `${method} ${url}`).toBe(401);
    }
  });

  it("balances are the ledger's: every account's balance equals its ledger, the books balance, and nothing derived has drifted", async () => {
    for (const a of (await owner.get("/financial-accounts")).body.financialAccounts as Array<{ id: string; currentBalance: number }>) {
      expect((await owner.get(`/financial-accounts/${a.id}/ledger`)).body.closingBalance, a.id).toBe(a.currentBalance);
    }
    expect((await owner.get("/trial-balance")).body.balanced).toBe(true);
    const checks = await owner.post("/reconciliation/run", { checks: ["ledger.integrity", "treasury.integrity"] });
    expect(checks.body.results.map((r: { status: string }) => r.status)).toEqual(["MATCHED", "MATCHED"]);
    const fields = Object.keys(prisma.financialAccount.fields);
    expect(fields.some((f) => /balance/i.test(f))).toBe(false); // no stored balance to drift
  });

  it("the integrity check detects drift if it were ever forced in (maintenance purge only)", async () => {
    const st = await prisma.bankTransaction.findFirstOrThrow({ where: { financialAccountId: fa.gateway.id } });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
      await tx.$executeRawUnsafe(`UPDATE "BankTransaction" SET "matchedAmount" = 1 WHERE id = '${st.id}'`);
    });
    const r = await owner.post("/reconciliation/run", { checks: ["treasury.integrity"] });
    expect(r.body.results[0]).toMatchObject({ status: "DIFFERENCE", details: { statementLinesWithMatchDrift: [st.id] } });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL finance.maintenance_purge = 'on'`);
      await tx.$executeRawUnsafe(`UPDATE "BankTransaction" SET "matchedAmount" = 0 WHERE id = '${st.id}'`);
    });
  });
});
