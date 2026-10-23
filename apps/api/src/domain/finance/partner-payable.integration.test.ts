import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { installId } from "../../config/installation";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import type { FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { processFinancialEvent, recordFinancialEvent } from "./events.service";
import { postJournalInTx } from "./journal.service";
import { PROFIT_SHARE_EVENT } from "./owner-books-posting-rules";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";

// What a partner can be paid (partner finance plan §6, §13): posted payable less
// payments waiting for approval, checked under the partner's lock on every way money can leave a partner's account —
// the Pay route, generic Treasury withdrawals and adjustments, approvals — and when a deposit is reversed. Only the owner
// moves a partner's money; hand-written journals never touch a partner's accounts.

const CSRF = "vitest-csrf";
type Role = "OWNER" | "FINANCE_ADMIN" | "ACCOUNTANT";
function agent(adminId: string, role: Role) {
  const cookie = [`access_token=${signAccessToken({ adminId, role })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1/finance${url}`)),
    post: (url: string, body: object = {}, key?: string) => {
      const r = auth(request(app).post(`/api/v1/finance${url}`));
      return (key ? r.set("Idempotency-Key", key) : r).send(body);
    },
    put: (url: string, body: object = {}) => auth(request(app).put(`/api/v1/finance${url}`)).send(body),
  };
}
const madeAdmins: string[] = [];
async function adminWith(role: Role) {
  const a = await prisma.adminUser.create({ data: { name: `PG ${role}`, email: `pg-${role.toLowerCase()}-${madeAdmins.length}-${RUN}@example.com`, passwordHash: await bcrypt.hash("x", 4), role } });
  madeAdmins.push(a.id);
  return agent(a.id, role);
}

let OWNER: FinanceActor;
let ownerA: ReturnType<typeof agent>;
let ownerB: ReturnType<typeof agent>;
let fa: ReturnType<typeof agent>;
let acc: ReturnType<typeof agent>;
let bank1 = ""; // BANK, no approval threshold
let bank2 = ""; // BANK, approval at 5,000
let cash1 = ""; // CASH
let bank1Ledger = "";
let accounts: Record<string, string> = {};
let seq = 0;
const key = (name: string) => `pg-${name}-${++seq}-${RUN}`;

interface P { id: string; name: string; cur: string; cap: string }
async function partner(role: "WORKING" | "INVESTOR" = "WORKING"): Promise<P> {
  const name = `Partner ${++seq} ${RUN}`;
  const r = await ownerA.post("/equity/partners", { name, joinedOn: "2026-08-01", role });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.id, name, cur: r.body.currentAccount.id, cap: r.body.capitalAccount.id };
}

/** What the partner is owed, through the real profit-share posting rule (Dr 3350 / Cr their current account). */
async function owe(p: P, amount: number) {
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const eventId = await financeTransaction(async (tx) => {
    await ensureOwnerBooksSetupInTx(tx, business, OWNER);
    const { event } = await recordFinancialEvent(tx, {
      contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: ctx.brand.key,
      source: { installId, system: "finance", entityType: "Partner", entityId: p.id },
      event: { type: PROFIT_SHARE_EVENT, version: 1, key: `pg-share:${p.id}:${++seq}`, occurredAt: new Date().toISOString() },
      financialDate: "2026-09-30", currency: business.baseCurrency,
      payload: { partnerId: p.id, partnerName: p.name, period: "2026-09", amount: amount * 100, currentAccountId: p.cur },
    });
    return event.id;
  });
  await processFinancialEvent(eventId);
}

/** Simulates a line written before this guard existed (legacy data): a debit straight onto the partner's account. */
async function legacyDebit(p: P, amount: number) {
  const { business } = await getFinanceContext();
  await financeTransaction((tx) => postJournalInTx(tx, business, {
    entryDate: "2026-09-30", description: "legacy line (test fixture)", kind: "EVENT", sourceType: "TestFixture", idempotencyKey: key("legacy"),
    lines: [{ accountId: p.cur, debit: amount * 100, credit: 0 }, { accountId: bank1Ledger, debit: 0, credit: amount * 100 }],
  }, OWNER));
}

async function state(p: P) {
  const [lines, pending] = await Promise.all([
    prisma.journalLine.aggregate({ where: { accountId: p.cur, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } }),
    prisma.treasuryMovement.aggregate({ where: { counterAccountId: p.cur, status: "PENDING_APPROVAL" }, _sum: { amount: true } }),
  ]);
  return { P: Number(lines._sum.credit ?? 0) - Number(lines._sum.debit ?? 0), C: Number(pending._sum.amount ?? 0) };
}
async function capital(p: P) {
  const l = await prisma.journalLine.aggregate({ where: { accountId: p.cap, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return Number(l._sum.credit ?? 0) - Number(l._sum.debit ?? 0);
}
async function linesOf(entryId: string) {
  const rows = await prisma.journalLine.findMany({ where: { entryId }, select: { accountId: true, debit: true, credit: true } });
  return rows.map((r) => ({ accountId: r.accountId, debit: Number(r.debit), credit: Number(r.credit) })).sort((a, b) => b.debit - a.debit);
}
const pay = (who: ReturnType<typeof agent>, p: P, amount: number, from = bank1, k = key("pay")) =>
  who.post(`/equity/partners/${p.id}/pay`, { fromFinancialAccountId: from, amount, method: "BANK" }, k);
const withdraw = (who: ReturnType<typeof agent>, counter: string, amount: number, from = bank1) =>
  who.post("/movements/withdrawal", { movementDate: "2026-10-01", amount, description: "test withdrawal", fromFinancialAccountId: from, counterAccountId: counter }, key("wd"));
const deposit = (who: ReturnType<typeof agent>, counter: string, amount: number, to = bank1) =>
  who.post("/movements/deposit", { movementDate: "2026-10-01", amount, description: "test deposit", toFinancialAccountId: to, counterAccountId: counter }, key("dep"));
const reverse = (who: ReturnType<typeof agent>, movementId: string) => who.post(`/movements/${movementId}/reverse`, { reason: "test reversal" });

beforeAll(async () => {
  await purgeFinanceTables();
  const admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  ownerA = agent(admin, "OWNER");
  [ownerB, fa, acc] = await Promise.all([adminWith("OWNER"), adminWith("FINANCE_ADMIN"), adminWith("ACCOUNTANT")]);
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-08-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [1], basePrice: 100 });
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "OB-PG", name: "seed", quantity: 1, unitCost: 10, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-08-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  const mk = async (body: object) => { const r = await ownerA.post("/financial-accounts", body); expect(r.status, JSON.stringify(r.body)).toBe(201); return r.body.id as string; };
  bank1 = await mk({ kind: "BANK", name: `PG bank 1 ${RUN}` });
  bank2 = await mk({ kind: "BANK", name: `PG bank 2 ${RUN}`, approvalThreshold: 5000 });
  cash1 = await mk({ kind: "CASH", name: `PG cash ${RUN}` });
  bank1Ledger = (await prisma.financialAccount.findUniqueOrThrow({ where: { id: bank1 }, select: { ledgerAccountId: true } })).ledgerAccountId;
  accounts = Object.fromEntries(((await ownerA.get("/accounts")).body.accounts as Array<{ id: string; code: string }>).map((a) => [a.code, a.id]));
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
  await prisma.auditLog.deleteMany({ where: { adminId: { in: madeAdmins } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: madeAdmins } } });
});

describe("paying a partner", () => {
  it("T1 full payment posts Dr current / Cr bank and leaves nothing owed", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const r = await pay(ownerA, w, 10_000);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.movement.status).toBe("POSTED");
    const m = await prisma.treasuryMovement.findUniqueOrThrow({ where: { id: r.body.movement.id } });
    expect(await linesOf(m.journalEntryId!)).toEqual([{ accountId: w.cur, debit: 10_000, credit: 0 }, { accountId: bank1Ledger, debit: 0, credit: 10_000 }]);
    expect(await state(w)).toEqual({ P: 0, C: 0 });
  });

  it("T3 a payment waiting for approval is reserved: a second payment only fits the rest", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const first = await pay(ownerA, w, 8_000, bank2);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.movement.status).toBe("PENDING_APPROVAL");
    expect(await state(w)).toEqual({ P: 10_000, C: 8_000 });
    const second = await pay(ownerA, w, 10_000);
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.details).toMatchObject({ code: "PAY_MORE_THAN_AVAILABLE", postedPayable: 10_000, pending: 8_000, available: 2_000 });
    expect(await prisma.treasuryMovement.count({ where: { counterAccountId: w.cur } })).toBe(1);
    expect((await pay(ownerA, w, 2_000)).status).toBe(201);
  });

  it("T3b more than is owed at all is still the old 400 on the Pay route", async () => {
    const w = await partner();
    await owe(w, 1_000);
    const r = await pay(ownerA, w, 1_500);
    expect(r.status).toBe(400);
    expect(r.body.details.code).toBe("PAY_MORE_THAN_OWED");
  });

  it("T4 two payments at once from the two entry points: exactly one spends the balance", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const [a, b] = await Promise.all([pay(ownerA, w, 10_000, bank1, key("pay-dialog")), pay(ownerA, w, 10_000, bank1, key("quick-add"))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await state(w)).toEqual({ P: 0, C: 0 });
  });

  it("T5 every Treasury route that debits a partner is the owner's and is checked", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const adjOut = (who: ReturnType<typeof agent>) => who.post("/movements/adjustment", { movementDate: "2026-10-01", amount: 1_000, description: "adj", financialAccountId: bank1, direction: "OUT", counterAccountId: w.cur, reason: "test adjustment" }, key("adj"));
    for (const r of [await withdraw(fa, w.cur, 1_000), await withdraw(acc, w.cur, 1_000), await adjOut(fa), await deposit(fa, w.cur, 1_000)]) {
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.details.code).toBe("PARTNER_ACCOUNT_SENSITIVE");
    }
    expect(await prisma.treasuryMovement.count({ where: { counterAccountId: w.cur } })).toBe(0);
    const over = await withdraw(ownerA, w.cur, 12_000);
    expect(over.status).toBe(409);
    expect(over.body.details.code).toBe("PAY_MORE_THAN_AVAILABLE");
    const ok = await withdraw(ownerA, w.cur, 4_000);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.movement.status).toBe("POSTED");
    expect(await state(w)).toEqual({ P: 6_000, C: 0 });
    // the owner's own drawings are not a payable: unchanged for a finance admin
    const drawings = await withdraw(fa, accounts["3300"]!, 500);
    expect(drawings.status, JSON.stringify(drawings.body)).toBe(201);
  });

  it("T6 approval re-checks: a payable that fell after the request refuses the approval", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const pending = await pay(ownerA, w, 8_000, bank2);
    expect(pending.body.movement.status).toBe("PENDING_APPROVAL");
    await legacyDebit(w, 5_000);
    const approve = await ownerB.post(`/movements/${pending.body.movement.id}/approve`);
    expect(approve.status, JSON.stringify(approve.body)).toBe(409);
    expect(approve.body.details).toMatchObject({ code: "PAY_MORE_THAN_AVAILABLE", postedPayable: 5_000, pending: 0, available: 5_000 });
    expect((await prisma.treasuryMovement.findUniqueOrThrow({ where: { id: pending.body.movement.id } })).status).toBe("PENDING_APPROVAL");
    const reject = await ownerB.post(`/movements/${pending.body.movement.id}/reject`, { reason: "payable changed" });
    expect(reject.status).toBe(200);
    expect(await state(w)).toEqual({ P: 5_000, C: 0 });
  });

  it("T6b the person who asked can't approve a high-value payment (existing rule); T7 rejecting frees the reserve", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const pending = await pay(ownerA, w, 8_000, bank2);
    const self = await ownerA.post(`/movements/${pending.body.movement.id}/approve`);
    expect(self.status).toBe(409);
    expect(self.body.details.code).toBe("SAME_PERSON_APPROVAL");
    const reject = await ownerA.post(`/movements/${pending.body.movement.id}/reject`, { reason: "not now" });
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe("REJECTED");
    expect(reject.body.journalEntryId ?? null).toBeNull();
    expect(await state(w)).toEqual({ P: 10_000, C: 0 });
  });

  it("T6c a different owner approves within the balance", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const pending = await pay(ownerA, w, 8_000, bank2);
    const ok = await ownerB.post(`/movements/${pending.body.movement.id}/approve`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await state(w)).toEqual({ P: 2_000, C: 0 });
  });
});

describe("reversing", () => {
  it("T8 undoing a payment credits the partner back; a finance admin can't", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const paid = await pay(ownerA, w, 4_000);
    const other = await pay(ownerA, w, 1_000);
    const r = await reverse(ownerA, paid.body.movement.id);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.movement.status).toBe("REVERSED");
    expect(await linesOf(r.body.movement.reversalJournalEntryId)).toEqual([{ accountId: bank1Ledger, debit: 4_000, credit: 0 }, { accountId: w.cur, debit: 0, credit: 4_000 }]);
    expect(await state(w)).toEqual({ P: 9_000, C: 0 });
    const denied = await reverse(fa, other.body.movement.id);
    expect(denied.status).toBe(403);
    expect(denied.body.details.code).toBe("PARTNER_ACCOUNT_SENSITIVE");
    expect((await prisma.treasuryMovement.findUniqueOrThrow({ where: { id: other.body.movement.id } })).status).toBe("POSTED");
  });

  it("T36 a deposit credits the partner; undoing it debits them and is checked", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const d = await deposit(ownerA, w.cur, 1_000);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const m = await prisma.treasuryMovement.findUniqueOrThrow({ where: { id: d.body.movement.id } });
    expect(await linesOf(m.journalEntryId!)).toEqual([{ accountId: bank1Ledger, debit: 1_000, credit: 0 }, { accountId: w.cur, debit: 0, credit: 1_000 }]);
    expect(await state(w)).toEqual({ P: 11_000, C: 0 });
    const r = await reverse(ownerA, d.body.movement.id);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await linesOf(r.body.movement.reversalJournalEntryId)).toEqual([{ accountId: w.cur, debit: 1_000, credit: 0 }, { accountId: bank1Ledger, debit: 0, credit: 1_000 }]);
    expect(await state(w)).toEqual({ P: 10_000, C: 0 });
  });

  it("T37 a deposit whose money was already paid out can't be reversed", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const d = await deposit(ownerA, w.cur, 1_000);
    expect((await pay(ownerA, w, 11_000)).status).toBe(201);
    const r = await reverse(ownerA, d.body.movement.id);
    expect(r.status).toBe(409);
    expect(r.body.details).toMatchObject({ code: "REVERSAL_EXCEEDS_AVAILABLE", postedPayable: 0, pending: 0, available: 0, amount: 1_000 });
    const m = await prisma.treasuryMovement.findUniqueOrThrow({ where: { id: d.body.movement.id } });
    expect(m.status).toBe("POSTED");
    expect(m.reversalJournalEntryId).toBeNull();
    expect(await state(w)).toEqual({ P: 0, C: 0 });
  });

  it("T38 a pending payment holds the deposit back until it is rejected", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const d = await deposit(ownerA, w.cur, 1_000);
    const pending = await pay(ownerA, w, 10_500, bank2);
    expect(pending.body.movement.status).toBe("PENDING_APPROVAL");
    const blocked = await reverse(ownerA, d.body.movement.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details).toMatchObject({ code: "REVERSAL_EXCEEDS_AVAILABLE", postedPayable: 11_000, pending: 10_500, available: 500, amount: 1_000 });
    expect((await ownerB.post(`/movements/${pending.body.movement.id}/reject`, { reason: "hold" })).status).toBe(200);
    const ok = await reverse(ownerA, d.body.movement.id);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await state(w)).toEqual({ P: 10_000, C: 0 });
  });

  it("T39 capital: put in, returned, and reversals both ways keep capital at or above zero", async () => {
    const i = await partner("INVESTOR");
    const put = await deposit(ownerA, i.cap, 50_000);
    expect(put.status, JSON.stringify(put.body)).toBe(201);
    const back = await withdraw(ownerA, i.cap, 45_000);
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect((await withdraw(ownerA, i.cap, 6_000)).body.details.code).toBe("CAPITAL_RETURN_EXCEEDS");
    const blocked = await reverse(ownerA, put.body.movement.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details).toMatchObject({ code: "REVERSAL_EXCEEDS_CAPITAL", capital: 5_000, available: 5_000, amount: 50_000 });
    expect((await reverse(ownerA, back.body.movement.id)).status).toBe(201);
    expect(await capital(i)).toBe(50_000);
    expect((await reverse(ownerA, put.body.movement.id)).status).toBe(201);
    expect(await capital(i)).toBe(0);
  });
});

describe("advances — the owner pays beyond what is owed, on purpose", () => {
  it("T41 an advance with a reason may take the account below zero; later shares bring it back, nothing is taken", async () => {
    const w = await partner();
    await owe(w, 1_000);
    const r = await ownerA.post(`/equity/partners/${w.id}/pay`, { fromFinancialAccountId: bank1, amount: 3_000, method: "BANK", advanceReason: "Eid advance, agreed with the owner" }, key("adv"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.movement.status).toBe("POSTED");
    expect(r.body.movement.description).toMatch(/^Withdrawal: Advance paid to|^Advance paid to/);
    expect(await state(w)).toEqual({ P: -2_000, C: 0 });
    const audit = await prisma.financeAuditEntry.findFirst({ where: { action: "movement.partner_advance", entityId: r.body.movement.id } });
    expect(audit?.reason).toBe("Eid advance, agreed with the owner");
    // a later share credits the account; nothing is taken from it automatically
    await owe(w, 5_000);
    expect(await state(w)).toEqual({ P: 3_000, C: 0 });
  });

  it("T42 without a reason it is refused; only the owner may advance; only to a partner's current account", async () => {
    const w = await partner();
    await owe(w, 1_000);
    expect((await pay(ownerA, w, 3_000)).status).toBe(400);
    expect((await withdraw(ownerA, w.cur, 3_000)).body.details.code).toBe("PAY_MORE_THAN_AVAILABLE");
    const advanceBy = (who: ReturnType<typeof agent>, counter: string) =>
      who.post("/movements/withdrawal", { movementDate: "2026-10-01", amount: 3_000, description: "advance", fromFinancialAccountId: bank1, counterAccountId: counter, partnerAdvanceReason: "advance against shares" }, key("adv"));
    const byFa = await advanceBy(fa, w.cur);
    expect(byFa.status).toBe(403);
    expect(byFa.body.details.code).toBe("PARTNER_ACCOUNT_SENSITIVE");
    const toCapital = await advanceBy(ownerA, w.cap);
    expect(toCapital.status).toBe(400);
    expect(toCapital.body.details.code).toBe("ADVANCE_NOT_ALLOWED");
    const toDrawings = await advanceBy(ownerA, accounts["3300"]!);
    expect(toDrawings.status).toBe(400);
    expect(toDrawings.body.details.code).toBe("ADVANCE_NOT_ALLOWED");
    expect(await state(w)).toEqual({ P: 1_000, C: 0 });
    const ok = await advanceBy(ownerA, w.cur);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await state(w)).toEqual({ P: -2_000, C: 0 });
  });

  it("T43 an advance that waits for approval is still an advance when a second owner approves it", async () => {
    const w = await partner();
    await owe(w, 1_000);
    const r = await ownerA.post(`/equity/partners/${w.id}/pay`, { fromFinancialAccountId: bank2, amount: 6_000, method: "BANK", advanceReason: "school fees advance" }, key("adv"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.movement.status).toBe("PENDING_APPROVAL");
    const ok = await ownerB.post(`/movements/${r.body.movement.id}/approve`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await state(w)).toEqual({ P: -5_000, C: 0 });
  });
});

describe("compatibility and journals", () => {
  it("T31/T40 owner-paid expenses keep working; reversing a partner's capital funding is the owner's", async () => {
    const w = await partner();
    const body = (partnerId: string | null) => ({ cashFinancialAccountId: cash1, expenseAccountId: accounts["6100"]!, amount: 2_000, description: "printer paid by the owner", funding: "CAPITAL", partnerId });
    const toPartner = await fa.post("/expenses/owner-paid", body(w.id), key("op"));
    expect(toPartner.status, JSON.stringify(toPartner.body)).toBe(201);
    const toOwner = await fa.post("/expenses/owner-paid", body(null), key("op"));
    expect(toOwner.status, JSON.stringify(toOwner.body)).toBe(201);
    const byAccountant = await acc.post("/expenses/owner-paid", body(null), key("op"));
    expect(byAccountant.status).toBe(409);
    expect(byAccountant.body.details.code).toBe("FUNDING_NEEDS_APPROVAL");
    expect(await capital(w)).toBe(2_000);
    const denied = await reverse(fa, toPartner.body.funding.id);
    expect(denied.status).toBe(403);
    expect(denied.body.details.code).toBe("PARTNER_ACCOUNT_SENSITIVE");
  });

  it("T35 a hand-written journal can't touch a partner's accounts", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const lines = [{ accountId: w.cur, debit: 1_000, credit: 0 }, { accountId: bank1Ledger, debit: 0, credit: 1_000 }];
    for (const who of [fa, ownerA]) {
      const r = await who.post("/journals", { entryDate: "2026-10-01", description: "try", lines }, key("j"));
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.details.code).toBe("PARTNER_ACCOUNT_OWNED");
    }
    const other = await ownerA.post("/journals", { entryDate: "2026-10-01", description: "unrelated", lines: [{ accountId: accounts["6100"]!, debit: 100, credit: 0 }, { accountId: bank1Ledger, debit: 0, credit: 100 }] }, key("j"));
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    const edit = await ownerA.put(`/journals/${other.body.journal.id}`, { entryDate: "2026-10-01", description: "edited", lines });
    expect(edit.status).toBe(409);
    expect(edit.body.details.code).toBe("PARTNER_ACCOUNT_OWNED");
    expect(await state(w)).toEqual({ P: 10_000, C: 0 });
  });
});
