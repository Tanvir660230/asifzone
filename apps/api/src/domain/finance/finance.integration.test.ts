import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RECONCILIATION_CHECK_KEYS } from "./reconciliation.service";
import request from "supertest";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { installId } from "../../config/installation";
import { signAccessToken } from "../../lib/jwt";
import { ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import { OUTBOX_CONSUMERS } from "../outbox/consumers";
import { getFinanceContext } from "./finance-context";
import { processFinancialEvent, recordFinancialEvent, registerPostingRule, unregisterPostingRuleForTests } from "./events.service";
import { financeTransaction } from "./finance-tx";

// Financial Core Phase 1 (docs/FINANCE_PHASE_1.md §10): the ledger's guarantees, proven against the real database —
// accounting invariants, idempotency, posted-entry immutability, audit atomicity, permissions, opening balances and
// reconciliation. The finance tables are purged before and after (maintenance purge: test databases only).

const CSRF = "vitest-csrf";
function agent(adminId: string | null, role: "OWNER" | "STAFF" = "OWNER") {
  const cookie = adminId ? [`access_token=${signAccessToken({ adminId, role })}`, `csrf_token=${CSRF}`] : [`csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, headers: Record<string, string> = {}) => auth(request(app).post(`/api/v1/finance${url}`)).set(headers).send(body),
    patch: (url: string, body: object = {}) => auth(request(app).patch(`/api/v1/finance${url}`)).send(body),
    put: (url: string, body: object = {}) => auth(request(app).put(`/api/v1/finance${url}`)).send(body),
    delete: (url: string) => auth(request(app).delete(`/api/v1/finance${url}`)),
  };
}

const purgeFinance = purgeFinanceTables;

const OPENING = "2026-07-01";
let owner: ReturnType<typeof agent>;
let staffId: string;
let acc: Record<string, string> = {};
let cashFa: { id: string; ledgerAccount: { id: string } };
let walletFa: { id: string; ledgerAccount: { id: string } };

const auditCount = () => prisma.financeAuditEntry.count();
const lines = (debitAccount: string, creditAccount: string, amount: number) => [
  { accountId: debitAccount, debit: amount, credit: 0 },
  { accountId: creditAccount, debit: 0, credit: amount },
];
async function postManual(entryDate: string, debitAccount: string, creditAccount: string, amount: number, description = "test journal") {
  const created = await owner.post("/journals", { entryDate, description, lines: lines(debitAccount, creditAccount, amount) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const posted = await owner.post(`/journals/${created.body.journal.id}/post`);
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  return posted.body.journal as { id: string; number: number; lines: Array<{ accountId: string; debit: number; credit: number }> };
}

beforeAll(async () => {
  await purgeFinance();
  owner = agent(await ownerId());
  staffId = (await prisma.adminUser.create({ data: { name: "Finance staff", email: `fin-staff-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role: "STAFF" } })).id;
});

afterAll(async () => {
  unregisterPostingRuleForTests("test.sale", 1);
  await purgeFinance();
  await prisma.auditLog.deleteMany({ where: { adminId: staffId } });
  await prisma.adminUser.delete({ where: { id: staffId } });
});

describe("financial core — permissions and bootstrap", () => {
  it("finance is OWNER-only: anonymous 401, STAFF 403 on every kind of route", async () => {
    expect((await agent(null).get("/business")).status).toBe(401);
    const staff = agent(staffId, "STAFF");
    expect((await staff.get("/business")).status).toBe(403);
    expect((await staff.get("/journals")).status).toBe(403);
    expect((await staff.post("/journals", {})).status).toBe(403);
    expect((await staff.post("/reconciliation/run", {})).status).toBe(403);
    expect((await staff.get("/audit")).status).toBe(403);
  });

  it("the first OWNER read bootstraps the business, this installation's brand and the chart — every row audited", async () => {
    const res = await owner.get("/business");
    expect(res.status).toBe(200);
    expect(res.body.business).toMatchObject({ key: "main", openingDate: null, fiscalYearStartMonth: 7 });
    expect(res.body.installationBrand.key).toBe(installId);
    const accounts = (await owner.get("/accounts")).body.accounts as Array<{ id: string; code: string }>;
    acc = Object.fromEntries(accounts.map((a) => [a.code, a.id]));
    expect(acc["1610"] && acc["4100"] && acc["3900"]).toBeTruthy();
    const unaudited = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM "LedgerAccount" a WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'LedgerAccount' AND f."entityId" = a.id)`;
    expect(Number(unaudited[0]!.n)).toBe(0);
    // A second read is not a second bootstrap.
    expect((await owner.get("/business")).body.business.id).toBe(res.body.business.id);
    expect(await prisma.financeBusiness.count()).toBe(1);
  });

  it("nothing posts before the Financial Opening Date is set", async () => {
    const draft = await owner.post("/journals", { entryDate: "2026-08-01", description: "too early", lines: lines(acc["6100"]!, acc["3100"]!, 10) });
    expect(draft.status).toBe(201);
    const post = await owner.post(`/journals/${draft.body.journal.id}/post`);
    expect(post.status).toBe(409);
    expect(post.body.details.code).toBe("OPENING_DATE_NOT_SET");
    expect((await owner.delete(`/journals/${draft.body.journal.id}`)).status).toBe(204);
  });

  it("sets the opening date and creates financial accounts with their own ledger accounts", async () => {
    const res = await owner.patch("/business", { openingDate: OPENING, reason: "books start" });
    expect(res.status).toBe(200);
    expect(res.body.business.openingDate).toBe(OPENING);
    const cash = await owner.post("/financial-accounts", { kind: "CASH", name: "Cash box" });
    const wallet = await owner.post("/financial-accounts", { kind: "MOBILE_WALLET", name: "bKash merchant", provider: "bKash", accountNumberLast4: "1234" });
    expect(cash.status).toBe(201);
    expect(wallet.status).toBe(201);
    cashFa = cash.body;
    walletFa = wallet.body;
    expect(cash.body.ledgerAccount.code).toBe("1101");
    expect(wallet.body.ledgerAccount.code).toBe("1301");
  });
});

describe("financial core — opening balances", () => {
  it("validates categories against account types", async () => {
    const bad = await owner.put("/opening-balances/lines", { lines: [{ category: "PAYABLE", accountId: acc["1510"], side: "CREDIT", amount: 10 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.details.code).toBe("OPENING_CATEGORY_TYPE");
  });

  it("posts one balanced OPENING_BALANCE journal; MISSING inventory is never given a cost", async () => {
    const saved = await owner.put("/opening-balances/lines", {
      notes: "Statement at opening",
      lines: [
        { category: "CASH", financialAccountId: cashFa.id, side: "DEBIT", amount: 10000 },
        { category: "MOBILE_WALLET", financialAccountId: walletFa.id, side: "DEBIT", amount: 5000 },
        { category: "PAYABLE", accountId: acc["2110"], side: "CREDIT", amount: 3000, partyType: "SUPPLIER", partyId: "sup-1" },
        { category: "LOAN", accountId: acc["2510"], side: "CREDIT", amount: 4000 },
        { category: "CAPITAL", accountId: acc["3100"], side: "CREDIT", amount: 6000 },
      ],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const inv = await owner.put("/opening-balances/inventory", {
      items: [
        { sku: `FA-${RUN}`, name: "Known", quantity: 10, unitCost: 100, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationDate: OPENING, confidence: "HIGH" },
        { sku: `FB-${RUN}`, name: "Estimated", quantity: 5, valuationAmount: 250, valuationStatus: "ESTIMATED", valuationMethod: "OWNER_ESTIMATE", valuationDate: OPENING, confidence: "LOW" },
        { sku: `FC-${RUN}`, name: "Missing", quantity: 7, valuationStatus: "MISSING", valuationMethod: "NONE", valuationDate: OPENING },
      ],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    expect(inv.body.summary.inventory).toMatchObject({ valuedTotal: 1250, unvaluedQuantity: 7, missing: { items: 1, quantity: 7 } });
    expect(inv.body.summary.openingBalanceEquity).toEqual({ side: "CREDIT", amount: 3250 });

    const posted = await owner.post("/opening-balances/post");
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    const j = posted.body.journal;
    expect(j).toMatchObject({ kind: "OPENING_BALANCE", status: "POSTED", entryDate: OPENING, totalDebit: 16250, totalCredit: 16250 });
    const invLine = j.lines.find((l: { accountId: string }) => l.accountId === acc["1610"]);
    expect(invLine).toMatchObject({ debit: 1250, valuationStatus: "OPENING_BALANCE" });
    const missing = await prisma.openingInventoryItem.findFirst({ where: { sku: `FC-${RUN}` } });
    expect(missing).toMatchObject({ valuationStatus: "MISSING", unitCost: null });
    expect(Number(missing!.valuationAmount)).toBe(0);
  });

  it("posted opening balances and the opening date are frozen", async () => {
    expect((await owner.post("/opening-balances/post")).body.details.code).toBe("OPENING_POSTED");
    expect((await owner.put("/opening-balances/lines", { lines: [] })).status).toBe(409);
    const locked = await owner.patch("/business", { openingDate: "2026-06-01" });
    expect(locked.status).toBe(409);
    expect(locked.body.details.code).toBe("OPENING_DATE_LOCKED");
    await expect(prisma.openingInventoryItem.updateMany({ where: { sku: `FC-${RUN}` }, data: { quantity: 99 } })).rejects.toThrow(/FINANCE_INVARIANT/);
  });
});

describe("financial core — accounting invariants", () => {
  it("the service refuses unbalanced journals, group accounts and dates before the books", async () => {
    const unbalanced = await owner.post("/journals", { entryDate: "2026-08-01", description: "x", lines: [{ accountId: acc["6100"], debit: 100 }, { accountId: acc["3100"], credit: 90 }] });
    expect(unbalanced.status).toBe(400);
    expect(unbalanced.body.details.code).toBe("JOURNAL_INVALID");
    const group = await owner.post("/journals", { entryDate: "2026-08-01", description: "x", lines: lines(acc["1100"]!, acc["3100"]!, 5) });
    expect(group.body.details.code).toBe("ACCOUNT_NOT_POSTABLE");
    const early = await owner.post("/journals", { entryDate: "2026-06-30", description: "x", lines: lines(acc["6100"]!, acc["3100"]!, 5) });
    const post = await owner.post(`/journals/${early.body.journal.id}/post`);
    expect(post.body.details.code).toBe("BEFORE_OPENING_DATE");
    await owner.delete(`/journals/${early.body.journal.id}`);
  });

  it("the database refuses an unbalanced posting even when the service is bypassed", async () => {
    const { business } = await getFinanceContext();
    const period = await prisma.financialPeriod.findFirstOrThrow({ where: { businessId: business.id, status: "OPEN" } });
    const attempt = prisma.$transaction(async (tx) => {
      const e = await tx.journalEntry.create({
        data: { businessId: business.id, entryDate: period.startDate, periodId: period.id, kind: "MANUAL", description: "bypass", currency: business.baseCurrency, totalDebit: 100, totalCredit: 90,
          lines: { create: [{ lineNo: 1, accountId: acc["6100"]!, debit: 100 }, { lineNo: 2, accountId: acc["3100"]!, credit: 90 }] } },
      });
      await tx.financeAuditEntry.create({ data: { actorType: "SYSTEM", actorLabel: "test", action: "bypass", entityType: "JournalEntry", entityId: e.id } });
      await tx.journalEntry.update({ where: { id: e.id }, data: { status: "POSTED", number: 999999, postedAt: new Date() } });
    });
    await expect(attempt).rejects.toThrow(/FINANCE_INVARIANT: journal .* is unbalanced/);
    expect(await prisma.journalEntry.count({ where: { description: "bypass" } })).toBe(0);
  });

  it("the database refuses a journal created directly as POSTED and lines on a group account", async () => {
    const { business } = await getFinanceContext();
    const period = await prisma.financialPeriod.findFirstOrThrow({ where: { businessId: business.id } });
    await expect(
      prisma.journalEntry.create({ data: { businessId: business.id, entryDate: period.startDate, periodId: period.id, kind: "MANUAL", description: "direct", currency: business.baseCurrency, status: "POSTED" } }),
    ).rejects.toThrow(/created as DRAFT/);
    await expect(
      prisma.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({ data: { businessId: business.id, entryDate: period.startDate, periodId: period.id, kind: "MANUAL", description: "group", currency: business.baseCurrency } });
        await tx.journalLine.create({ data: { entryId: e.id, lineNo: 1, accountId: acc["1100"]!, debit: 5 } });
      }),
    ).rejects.toThrow(/can't take postings/);
  });

  it("the trial balance balances", async () => {
    const tb = await owner.get("/trial-balance");
    expect(tb.status).toBe(200);
    expect(tb.body.balanced).toBe(true);
    expect(tb.body.totalDebit).toBe(tb.body.totalCredit);
  });
});

describe("financial core — idempotency", () => {
  it("a repeated draft request with the same Idempotency-Key returns the same journal; other content under it is refused", async () => {
    const body = { entryDate: "2026-08-03", description: "idem", lines: lines(acc["6300"]!, cashFa.ledgerAccount.id, 120) };
    const key = { "Idempotency-Key": `fin-idem-${RUN}` };
    const first = await owner.post("/journals", body, key);
    const second = await owner.post("/journals", body, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ replayed: true, journal: { id: first.body.journal.id } });
    const other = await owner.post("/journals", { ...body, lines: lines(acc["6300"]!, cashFa.ledgerAccount.id, 121) }, key);
    expect(other.status).toBe(409);
    expect(other.body.details.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const p1 = await owner.post(`/journals/${first.body.journal.id}/post`);
    const p2 = await owner.post(`/journals/${first.body.journal.id}/post`);
    expect(p1.body.alreadyPosted).toBe(false);
    expect(p2.body).toMatchObject({ alreadyPosted: true, journal: { number: p1.body.journal.number } });
  });

  it("a financial event delivered many times — even concurrently — is recorded once and posted once", async () => {
    registerPostingRule("test.sale", 1, {
      payload: z.object({ amount: z.number().int().positive() }),
      build: (p) => ({ description: "Test sale", lines: [{ account: "asset.receivable_trade", debit: p.amount, credit: 0 }, { account: "revenue.merchandise", debit: 0, credit: p.amount }] }),
    });
    const ctx = await getFinanceContext();
    const envelope = {
      contract: "finance.event" as const, contractVersion: 1 as const, businessKey: ctx.business.key, brandKey: ctx.brand.key,
      source: { installId, system: "commerce", entityType: "Order", entityId: `ord-${RUN}` },
      event: { type: "test.sale", version: 1, key: `order:${RUN}:realised`, occurredAt: "2026-08-10T10:00:00+06:00" },
      financialDate: "2026-08-10", currency: ctx.business.baseCurrency, payload: { amount: 77700 },
    };
    const first = await prisma.$transaction((tx) => recordFinancialEvent(tx, envelope));
    const again = await prisma.$transaction((tx) => recordFinancialEvent(tx, envelope));
    const altered = await prisma.$transaction((tx) => recordFinancialEvent(tx, { ...envelope, payload: { amount: 1 } }));
    expect(first.duplicate).toBe(false);
    expect(again).toMatchObject({ duplicate: true, payloadMatches: true, event: { id: first.event.id } });
    expect(altered).toMatchObject({ duplicate: true, payloadMatches: false });
    expect(await prisma.financialEvent.count({ where: { eventKey: envelope.event.key } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { consumer: "finance-event-post", aggregateId: first.event.id } })).toBe(1);

    const outcomes = await Promise.all([1, 2, 3, 4].map(() => processFinancialEvent(first.event.id)));
    expect(outcomes.filter((o) => o === "posted")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "already_posted")).toHaveLength(3);
    expect(await OUTBOX_CONSUMERS["finance-event-post"].handle({ financialEventId: first.event.id })).toBe("skipped");
    const journals = await prisma.journalEntry.findMany({ where: { financialEventId: first.event.id }, include: { lines: true } });
    expect(journals).toHaveLength(1);
    expect(journals[0]).toMatchObject({ kind: "EVENT", status: "POSTED", brandId: ctx.brand.id, sourceType: "Order", sourceId: `ord-${RUN}` });
    // A posted event is final in the database: it can't be reset to post again.
    await expect(prisma.financialEvent.update({ where: { id: first.event.id }, data: { status: "RECEIVED" } })).rejects.toThrow(/is final/);
  });

  it("an event without a posting rule is kept FAILED (never dropped) and a late event never reopens a closed period", async () => {
    const ctx = await getFinanceContext();
    const base = { contract: "finance.event" as const, contractVersion: 1 as const, businessKey: ctx.business.key, brandKey: ctx.brand.key, currency: ctx.business.baseCurrency };
    const orphan = await prisma.$transaction((tx) => recordFinancialEvent(tx, {
      ...base, source: { installId, system: "commerce", entityType: "Order", entityId: "x" },
      event: { type: "test.unknown", version: 1, key: `unknown:${RUN}`, occurredAt: "2026-08-11T00:00:00Z" }, financialDate: "2026-08-11", payload: {},
    }));
    expect(await processFinancialEvent(orphan.event.id)).toBe("no_rule");
    expect(await prisma.financialEvent.findUniqueOrThrow({ where: { id: orphan.event.id } })).toMatchObject({ status: "FAILED", lastError: expect.stringContaining("NO_POSTING_RULE") });

    const aug = await prisma.financialPeriod.findFirstOrThrow({ where: { businessId: ctx.business.id, startDate: new Date("2026-08-01T00:00:00Z") } });
    expect((await owner.post(`/periods/${aug.id}/close`, { reason: "month end" })).status).toBe(200);
    const late = await prisma.$transaction((tx) => recordFinancialEvent(tx, {
      ...base, source: { installId, system: "commerce", entityType: "Order", entityId: "late" },
      event: { type: "test.sale", version: 1, key: `late:${RUN}`, occurredAt: "2026-08-20T00:00:00Z" }, financialDate: "2026-08-20", payload: { amount: 500 },
    }));
    expect(await processFinancialEvent(late.event.id)).toBe("posted");
    const lateJournal = await prisma.journalEntry.findFirstOrThrow({ where: { financialEventId: late.event.id } });
    expect(lateJournal.entryDate.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(lateJournal.reference).toContain("2026-08-20");
    expect((await owner.post(`/periods/${aug.id}/reopen`, { reason: "test cleanup" })).status).toBe(200);
  });
});

describe("financial core — posted-entry immutability", () => {
  let journal: { id: string; number: number; lines: Array<{ accountId: string; debit: number; credit: number }> };

  beforeAll(async () => {
    journal = await postManual("2026-08-05", acc["6100"]!, cashFa.ledgerAccount.id, 900, "August rent");
  });

  it("the API refuses to edit or delete a posted journal", async () => {
    const edit = await owner.put(`/journals/${journal.id}`, { entryDate: "2026-08-05", description: "edited", lines: lines(acc["6100"]!, cashFa.ledgerAccount.id, 800) });
    expect(edit.body.details.code).toBe("JOURNAL_POSTED");
    expect((await owner.delete(`/journals/${journal.id}`)).body.details.code).toBe("JOURNAL_POSTED");
  });

  it("the database refuses any edit, deletion or truncation of posted journals and their lines", async () => {
    await expect(prisma.journalEntry.update({ where: { id: journal.id }, data: { description: "tampered" } })).rejects.toThrow(/immutable/);
    await expect(prisma.journalEntry.delete({ where: { id: journal.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(prisma.journalLine.updateMany({ where: { entryId: journal.id }, data: { memo: "tampered" } })).rejects.toThrow(/immutable/);
    await expect(prisma.journalLine.deleteMany({ where: { entryId: journal.id } })).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "JournalLine", "JournalEntry" CASCADE`)).rejects.toThrow(/can't be truncated/);
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: journal.id } })).description).toBe("August rent");
  });

  it("a reversal mirrors the original, is idempotent, and can't itself be reversed", async () => {
    const rev = await owner.post(`/journals/${journal.id}/reverse`, { reason: "posted to the wrong month" });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect(rev.body.reversal).toMatchObject({ kind: "REVERSAL", reversesEntryId: journal.id, status: "POSTED" });
    const mirrored = rev.body.reversal.lines.map((l: { accountId: string; debit: number; credit: number }) => [l.accountId, l.credit, l.debit]);
    expect(mirrored).toEqual(journal.lines.map((l) => [l.accountId, l.debit, l.credit]));
    const again = await owner.post(`/journals/${journal.id}/reverse`, { reason: "posted to the wrong month" });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ replayed: true, reversal: { id: rev.body.reversal.id } });
    expect((await owner.post(`/journals/${rev.body.reversal.id}/reverse`, { reason: "undo" })).body.details.code).toBe("REVERSAL_OF_REVERSAL");
    expect((await owner.get(`/journals/${journal.id}`)).body.reversedBy.id).toBe(rev.body.reversal.id);
  });

  it("a correction is Original → Reversal → Corrected entry, in one transaction", async () => {
    const original = await postManual("2026-08-06", acc["6300"]!, cashFa.ledgerAccount.id, 500, "Electricity");
    const res = await owner.post(`/journals/${original.id}/correct`, { reason: "bill was 450", lines: lines(acc["6300"]!, cashFa.ledgerAccount.id, 450) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.reversal).toMatchObject({ kind: "REVERSAL", reversesEntryId: original.id });
    expect(res.body.correction).toMatchObject({ kind: "CORRECTION", correctsEntryId: original.id, totalDebit: 450 });
    const after = (await owner.get(`/journals/${original.id}`)).body;
    expect(after).toMatchObject({ status: "POSTED", totalDebit: 500, reversedBy: { id: res.body.reversal.id }, correctedBy: { id: res.body.correction.id } });
    const ledger = (await owner.get(`/accounts/${acc["6300"]}/ledger?from=2026-08-06&to=2026-12-31`)).body;
    expect(ledger.closingBalance - ledger.openingBalance).toBe(450);
  });
});

describe("financial core — transactional audit trail", () => {
  it("every journal, account, mapping and financial account has an audit entry from its own transaction", async () => {
    const missing = await prisma.$queryRaw<Array<{ t: string; n: bigint }>>`
      SELECT 'JournalEntry' AS t, COUNT(*) AS n FROM "JournalEntry" x WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'JournalEntry' AND f."entityId" = x.id)
      UNION ALL SELECT 'FinancialAccount', COUNT(*) FROM "FinancialAccount" x WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'FinancialAccount' AND f."entityId" = x.id)
      UNION ALL SELECT 'AccountMapping', COUNT(*) FROM "AccountMapping" x WHERE NOT EXISTS (SELECT 1 FROM "FinanceAuditEntry" f WHERE f."entityType" = 'AccountMapping' AND f."entityId" = x.id)`;
    expect(missing.map((r) => [r.t, Number(r.n)])).toEqual([["JournalEntry", 0], ["FinancialAccount", 0], ["AccountMapping", 0]]);
    const postAudit = await prisma.financeAuditEntry.findFirst({ where: { action: "journal.reversed" } });
    expect(postAudit).toMatchObject({ actorType: "ADMIN", reason: "posted to the wrong month" });
    expect(postAudit!.actorLabel).toContain("@");
  });

  it("a finance change without its audit entry can't commit", async () => {
    const before = await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: acc["6900"]! } });
    await expect(prisma.ledgerAccount.update({ where: { id: before.id }, data: { name: "renamed without audit" } })).rejects.toThrow(/FINANCE_AUDIT_REQUIRED/);
    expect((await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: before.id } })).name).toBe(before.name);
    // An audit row for a different record doesn't count. The database rolls the commit back; financeTransaction makes
    // that a rejected call (a bare Prisma interactive transaction resolves even when its COMMIT fails).
    await expect(financeTransaction(async (tx) => {
      await tx.ledgerAccount.update({ where: { id: before.id }, data: { name: "still not audited" } });
      await tx.financeAuditEntry.create({ data: { actorType: "SYSTEM", actorLabel: "test", action: "x", entityType: "LedgerAccount", entityId: acc["6800"]! } });
    })).rejects.toMatchObject({ statusCode: 409, details: { code: "FINANCE_AUDIT_REQUIRED" } });
    await prisma.$transaction(async (tx) => {
      await tx.ledgerAccount.update({ where: { id: before.id }, data: { name: "bare transaction, no audit" } });
    }).catch(() => undefined);
    expect((await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: before.id } })).name).toBe(before.name);
    // With its audit entry in the same transaction, the change commits.
    await financeTransaction(async (tx) => {
      await tx.ledgerAccount.update({ where: { id: before.id }, data: { name: before.name } });
      await tx.financeAuditEntry.create({ data: { actorType: "SYSTEM", actorLabel: "test", action: "account.update", entityType: "LedgerAccount", entityId: before.id } });
    });
  });

  it("a failed operation leaves neither its changes nor its audit entries", async () => {
    const original = await postManual("2026-08-07", acc["6400"]!, cashFa.ledgerAccount.id, 300, "Hosting");
    const [audits, entries] = [await auditCount(), await prisma.journalEntry.count()];
    // The reversal half succeeds inside the transaction, then the corrected entry is unbalanced → everything rolls back.
    const res = await owner.post(`/journals/${original.id}/correct`, { reason: "bad fix", lines: [{ accountId: acc["6400"], debit: 300 }, { accountId: cashFa.ledgerAccount.id, credit: 200 }] });
    expect(res.status).toBe(400);
    expect(await auditCount()).toBe(audits);
    expect(await prisma.journalEntry.count()).toBe(entries);
    expect((await owner.get(`/journals/${original.id}`)).body.reversedBy).toBeNull();
  });

  it("the financial audit trail is append-only", async () => {
    const entry = await prisma.financeAuditEntry.findFirstOrThrow();
    await expect(prisma.financeAuditEntry.update({ where: { id: entry.id }, data: { reason: "rewritten" } })).rejects.toThrow(/append-only/);
    await expect(prisma.financeAuditEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    const res = await owner.get(`/audit?entityType=JournalEntry`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
  });
});

describe("financial core — periods", () => {
  it("a closed period accepts no posting; a period with drafts can't close; reopen is audited", async () => {
    const draft = await owner.post("/journals", { entryDate: "2026-09-10", description: "sept draft", lines: lines(acc["6500"]!, cashFa.ledgerAccount.id, 40) });
    const sept = (await owner.get("/periods")).body.periods.find((p: { startDate: string }) => p.startDate === "2026-09-01");
    expect((await owner.post(`/periods/${sept.id}/close`, { reason: "month end" })).body.details.code).toBe("PERIOD_HAS_DRAFTS");
    expect((await owner.post(`/periods/${sept.id}/soft-close`, { reason: "review" })).status).toBe(200);
    expect((await owner.post(`/journals/${draft.body.journal.id}/post`)).status).toBe(200); // OWNER holds finance.period_close
    expect((await owner.post(`/periods/${sept.id}/close`, { reason: "month end" })).status).toBe(200);
    const late = await owner.post("/journals", { entryDate: "2026-09-15", description: "late", lines: lines(acc["6500"]!, cashFa.ledgerAccount.id, 10) });
    expect((await owner.post(`/journals/${late.body.journal.id}/post`)).body.details.code).toBe("PERIOD_CLOSED");
    await owner.delete(`/journals/${late.body.journal.id}`);
    expect((await owner.post(`/periods/${sept.id}/reopen`, { reason: "late invoice" })).status).toBe(200);
    expect(await prisma.financeAuditEntry.count({ where: { entityId: sept.id, action: { in: ["period.soft_close", "period.close", "period.reopen"] } } })).toBe(3);
  });
});

describe("financial core — reconciliation", () => {
  it("compares the dashboard's revenue and COGS with the ledger and reports every difference exactly", async () => {
    const res = await owner.post("/reconciliation/run", {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byKey = Object.fromEntries((res.body.results as Array<{ checkKey: string }>).map((r) => [r.checkKey, r])) as unknown as Record<string, { status: string; expected: number | null; actual: number | null; difference: number | null; details: Record<string, unknown> }>;
    expect(byKey["ledger.integrity"]!.status).toBe("MATCHED");
    expect(byKey["settings.consistency"]!).toMatchObject({ status: "MATCHED", details: { mismatches: [] } });

    // Ledger revenue for this brand = the two test.sale events (777 + 5); the dashboard has no realised sales of its own
    // posted by a rule, so the difference is detected and stated to the paisa.
    const revenue = byKey["revenue.dashboard_vs_ledger"]!;
    expect(revenue.actual).toBe(782);
    expect(revenue.difference).toBe(revenue.actual! - revenue.expected!);
    expect(revenue.status).toBe(revenue.difference === 0 ? "MATCHED" : "DIFFERENCE");
    expect(revenue.details.dashboardMetric).toBe("realised_net_sales");

    const cogs = byKey["cogs.dashboard_vs_ledger"]!;
    expect(cogs.actual).toBe(0);
    expect(cogs.status).toBe(cogs.expected === 0 ? "MATCHED" : "DIFFERENCE");

    expect(byKey["events.unposted"]!).toMatchObject({ status: "DIFFERENCE", details: { unposted: 1 } });
    expect(byKey["cost.completeness"]!).toMatchObject({ status: "DIFFERENCE", details: { missingRecords: 1, estimatedRecords: 1 } });
    expect(res.body.ok).toBe(false);

    // One run per registered check (the list grows with each phase — 4C, 4D, manufacturing…).
    expect(await prisma.reconciliationRun.count()).toBe(RECONCILIATION_CHECK_KEYS.length);
    expect(await prisma.financeAuditEntry.count({ where: { action: "reconciliation.run" } })).toBe(RECONCILIATION_CHECK_KEYS.length);
    expect((await owner.get("/reconciliation/runs")).body.total).toBe(RECONCILIATION_CHECK_KEYS.length);
    expect((await owner.post("/reconciliation/run", { checks: ["nope"] })).body.details.code).toBe("RECONCILIATION_CHECK_UNKNOWN");
  });
});
