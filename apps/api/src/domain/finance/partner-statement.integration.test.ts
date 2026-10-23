import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import { postJournalInTx, reverseJournal } from "./journal.service";
import { PROFIT_SHARE_EVENT } from "./owner-books-posting-rules";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";

// One source for every partner and owner figure (partner finance plan §5, phase 2): each line on a partner's accounts is
// classed by what produced it; owed / waiting / payable now / earned / paid come from those classes; the statement adds up
// to the ledger; the owner's net capital and drawings are the same on every screen; every partner is listed while they
// have a balance — with a share or not, still here or gone.

const CSRF = "vitest-csrf";
let OWNER: FinanceActor;
let admin = "";
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
let bank = "";
let bank2 = "";
let bankLedger = "";
let seq = 0;
const key = (name: string) => `ps-${name}-${++seq}-${RUN}`;

interface P { id: string; name: string; cur: string; cap: string }
async function partner(extra: object = {}): Promise<P> {
  const name = `Statement partner ${++seq} ${RUN}`;
  const r = await api().post("/equity/partners", { name, joinedOn: "2026-08-01", role: "WORKING", ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.id, name, cur: r.body.currentAccount.id, cap: r.body.capitalAccount.id };
}
/** A posted share through the real posting rule; returns its journal entry. */
async function owe(p: P, amount: number) {
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const eventId = await financeTransaction(async (tx) => {
    await ensureOwnerBooksSetupInTx(tx, business, OWNER);
    const { event } = await recordFinancialEvent(tx, {
      contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: ctx.brand.key,
      source: { installId, system: "finance", entityType: "Partner", entityId: p.id },
      event: { type: PROFIT_SHARE_EVENT, version: 1, key: `ps-share:${p.id}:${++seq}`, occurredAt: new Date().toISOString() },
      financialDate: "2026-09-30", currency: business.baseCurrency,
      payload: { partnerId: p.id, partnerName: p.name, period: "2026-09", amount: amount * 100, currentAccountId: p.cur },
    });
    return event.id;
  });
  await processFinancialEvent(eventId);
  return prisma.journalEntry.findFirstOrThrow({ where: { financialEventId: eventId } });
}
const pay = (p: P, amount: number, from = bank) => api().post(`/equity/partners/${p.id}/pay`, { fromFinancialAccountId: from, amount, method: "BANK", paymentDate: "2026-10-05" }, key("pay"));
const overview = async (p: P) => (await api().get("/equity/profit-shares")).body.partners.find((x: { partnerId: string }) => x.partnerId === p.id);

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-08-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [1], basePrice: 100 });
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "OB-PS", name: "seed", quantity: 1, unitCost: 10, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-08-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  const mk = async (body: object) => { const r = await api().post("/financial-accounts", body); expect(r.status, JSON.stringify(r.body)).toBe(201); return r.body.id as string; };
  bank = await mk({ kind: "BANK", name: `PS bank ${RUN}` });
  bank2 = await mk({ kind: "BANK", name: `PS bank 2 ${RUN}`, approvalThreshold: 5000 });
  bankLedger = (await prisma.financialAccount.findUniqueOrThrow({ where: { id: bank }, select: { ledgerAccountId: true } })).ledgerAccountId;
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("a partner's figures, from the ledger", () => {
  it("owed, waiting, payable now, earned and paid agree; the old totals carry the same figures", async () => {
    const w = await partner({ profitSharePct: 20, shareFrom: "2026-08-01" });
    await owe(w, 10_000);
    expect((await pay(w, 3_000)).status).toBe(201);
    expect((await pay(w, 6_000, bank2)).body.movement.status).toBe("PENDING_APPROVAL");
    const o = await overview(w);
    expect(o.status).toBe("ACTIVE");
    expect(o.balances).toMatchObject({ postedPayable: 7_000, pendingCommitments: 6_000, availableToPay: 1_000, finalizedEarnings: 10_000, paymentsCompleted: 3_000, paidInAdvance: 0, unclassified: 0 });
    expect(o.totals).toEqual({ earned: 10_000, paid: 3_000, owed: 7_000 });
  });

  it("T16/T17 a partner with no share now, or who has left, is still listed with their balance and can be paid", async () => {
    const noShare = await partner();
    await owe(noShare, 3_000);
    const left = await partner({ profitSharePct: 10, shareFrom: "2026-08-01", leftOn: "2026-09-30" });
    await owe(left, 2_000);
    const a = await overview(noShare);
    expect(a).toMatchObject({ status: "NO_CURRENT_SHARE", sharePct: null, waitingMonths: [], runningMonth: null });
    expect(a.balances.availableToPay).toBe(3_000);
    const b = await overview(left);
    expect(b).toMatchObject({ status: "LEFT", runningMonth: null });
    expect(b.balances.availableToPay).toBe(2_000);
    expect((await pay(noShare, 3_000)).status).toBe(201);
    expect((await pay(left, 2_000)).status).toBe(201);
    const home = (await api().get("/owner-home")).body;
    expect(home.people.partners.find((p: { id: string }) => p.id === noShare.id)).toMatchObject({ available: 0, owed: 0 });
  });

  it("the history labels a reversed share as reversed, not as paid; earned goes down", async () => {
    const w = await partner();
    const share = await owe(w, 4_000);
    // a share is undone only as a correction with its evidence (never by reversing the journal by hand)
    await expect(reverseJournal(share.id, { reason: "posted to the wrong partner" }, OWNER)).rejects.toMatchObject({ details: { code: "JOURNAL_OWNED_BY_PROFIT_SHARE" } });
    const prop = await api().post("/equity/adjustments", { kind: "INVALID_POSTING", partnerId: w.id, relatedEntryId: share.id, reason: "posted to the wrong partner" });
    expect(prop.body.status, JSON.stringify(prop.body)).toBe("PROPOSED");
    expect((await api().post(`/equity/adjustments/${prop.body.id}/approve`)).status).toBe(200);
    const items = (await api().get(`/equity/partners/${w.id}/activity`)).body.items as Array<{ kind: string; class: string; amount: number }>;
    expect(items.map((i) => [i.kind, i.class, i.amount])).toEqual([["SHARE_REVERSED", "SHARE_REVERSAL", -4_000], ["PROFIT_SHARE", "SHARE", 4_000]]);
    const o = await overview(w);
    expect(o.balances).toMatchObject({ finalizedEarnings: 0, paymentsCompleted: 0, postedPayable: 0 });
  });

  it("T29 an entry that is neither a share nor a payment is shown as unclassified, and the statement still adds up", async () => {
    const w = await partner();
    await owe(w, 1_000);
    const { business } = await getFinanceContext();
    await financeTransaction((tx) => postJournalInTx(tx, business, {
      entryDate: "2026-09-30", description: "old hand-written line (fixture)", kind: "EVENT", sourceType: "TestFixture", idempotencyKey: key("legacy"),
      lines: [{ accountId: bankLedger, debit: 50_000, credit: 0 }, { accountId: w.cur, debit: 0, credit: 50_000 }],
    }, OWNER));
    expect((await overview(w)).balances).toMatchObject({ postedPayable: 1_500, unclassified: 500, finalizedEarnings: 1_000 });
    const s = (await api().get(`/equity/partners/${w.id}/statement`)).body;
    expect(s.current.lines.map((l: { class: string }) => l.class).sort()).toEqual(["SHARE", "UNCLASSIFIED"]);
    expect(s.current).toMatchObject({ closing: 1_500, ledgerBalance: 1_500, reconciled: true, difference: 0 });
  });
});

describe("the statement", () => {
  it("T24 shares, payments, a rejection, reversals both ways, a deposit and an advance all add up to the ledger", async () => {
    const w = await partner();
    await owe(w, 10_000);
    const p1 = await pay(w, 2_000);
    await pay(w, 1_000);
    const pending = await pay(w, 6_000, bank2);
    expect((await api().post(`/movements/${pending.body.movement.id}/reject`, { reason: "not now" })).status).toBe(200);
    expect((await api().post(`/movements/${p1.body.movement.id}/reverse`, { reason: "bounced" })).status).toBe(201);
    const dep = await api().post("/movements/deposit", { movementDate: "2026-10-06", amount: 500, description: "returned by partner", toFinancialAccountId: bank, counterAccountId: w.cur }, key("dep"));
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);
    expect((await api().post(`/movements/${dep.body.movement.id}/reverse`, { reason: "entered twice" })).status).toBe(201);
    const adv = await api().post(`/equity/partners/${w.id}/pay`, { fromFinancialAccountId: bank, amount: 12_000, method: "BANK", paymentDate: "2026-10-07", advanceReason: "advance for the test" }, key("adv"));
    expect(adv.status, JSON.stringify(adv.body)).toBe(201);
    // 10,000 earned − 1,000 paid − 12,000 advance = −3,000 (paid 3,000 in advance)
    const s = (await api().get(`/equity/partners/${w.id}/statement?from=2026-08-01`)).body;
    expect(s.current).toMatchObject({ opening: 0, closing: -3_000, ledgerBalance: -3_000, reconciled: true });
    expect(s.current.totals).toMatchObject({ SHARE: 10_000, PAYMENT: -15_000, PAYMENT_REVERSAL: 2_000, PARTNER_DEPOSIT: 500, PARTNER_DEPOSIT_REVERSAL: -500 });
    expect(s.current.lines.filter((l: { advance: boolean }) => l.advance)).toHaveLength(1);
    const later = (await api().get(`/equity/partners/${w.id}/statement?from=2026-10-06`)).body;
    expect(later.current.opening).toBe(7_000); // 10,000 − 2,000 − 1,000 by 10-05; the reversal is dated today
    expect(later.current.reconciled).toBe(true);
    expect((await overview(w)).balances).toMatchObject({ postedPayable: -3_000, availableToPay: 0, paidInAdvance: 3_000, paymentsCompleted: 13_000 });
  });
});

describe("the owner — net capital and drawings, the same everywhere", () => {
  it("T19/T34 owner summary, Finance home and Owner & partners agree, with a reversed drawing", async () => {
    const r = await api().post("/equity/partners", { name: `Owner ${RUN}`, joinedOn: "2026-08-01", role: "OWNER" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await api().post("/equity/owner/money", { kind: "INVEST", financialAccountId: bank, amount: 100_000, date: "2026-08-05" }, key("in"))).status).toBe(201);
    expect((await api().post("/equity/owner/money", { kind: "WITHDRAW", financialAccountId: bank, amount: 25_000, date: "2026-09-01" }, key("out"))).status).toBe(201);
    const wrong = await api().post("/equity/owner/money", { kind: "WITHDRAW", financialAccountId: bank, amount: 5_000, date: "2026-09-02" }, key("out"));
    expect((await api().post(`/movements/${wrong.body.movement.id}/reverse`, { reason: "never taken" })).status).toBe(201);
    const summary = (await api().get("/equity/owner/summary")).body;
    expect(summary).toMatchObject({ netCapital: 100_000, drawings: 25_000 });
    const home = (await api().get("/owner-home")).body.people.owner;
    expect(home).toMatchObject({ netCapital: 100_000, drawings: 25_000 });
    const eq = (await api().get("/equity")).body.partners.find((p: { role: string }) => p.role === "OWNER");
    expect([eq.balances.capital, -eq.balances.current]).toEqual([100_000, 25_000]);
  });

  it("T18 an investor's capital: put in, returned, never below zero; separate from what they are owed", async () => {
    const r = await api().post("/equity/partners", { name: `Capital investor ${RUN}`, joinedOn: "2026-08-01", role: "INVESTOR", agreedSharePct: 30 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.id;
    const capital = (kind: "CONTRIBUTE" | "RETURN", amount: number) => api().post(`/equity/partners/${id}/capital`, { kind, financialAccountId: bank, amount, date: "2026-09-01", method: "BANK" }, key("cap"));
    expect((await capital("CONTRIBUTE", 50_000)).status).toBe(201);
    expect((await capital("RETURN", 20_000)).status).toBe(201);
    const over = await capital("RETURN", 40_000);
    expect(over.status).toBe(409);
    expect(over.body.details).toMatchObject({ code: "CAPITAL_RETURN_EXCEEDS", capital: 30_000, available: 30_000 });
    const o = (await api().get("/equity/profit-shares")).body.partners.find((x: { partnerId: string }) => x.partnerId === id);
    expect(o.balances.capital).toEqual({ contributed: 50_000, returned: 20_000, net: 30_000 });
    expect(o.balances.postedPayable).toBe(0);
    const s = (await api().get(`/equity/partners/${id}/statement`)).body;
    expect(s.capital).toMatchObject({ closing: 30_000, reconciled: true });
    const items = (await api().get(`/equity/partners/${id}/activity`)).body.items.map((i: { kind: string }) => i.kind);
    expect(items).toEqual(["CAPITAL_BACK", "PUT_IN"]);
    // the owner's money is not a partner's capital
    const owner = (await api().get("/equity")).body.partners.find((p: { role: string }) => p.role === "OWNER");
    if (owner) expect((await api().post(`/equity/partners/${owner.id}/capital`, { kind: "CONTRIBUTE", financialAccountId: bank, amount: 1 }, key("cap"))).status).toBe(400);
  });

  it("ownership % and profit-share % are separate fields", async () => {
    const r = await api().post("/equity/partners", { name: `Investor ${RUN}`, joinedOn: "2026-08-01", role: "INVESTOR", agreedSharePct: 30, profitSharePct: 10, shareFrom: "2026-08-01" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ ownershipPct: 30, profitSharePct: 10 });
    const after = await api().patch(`/equity/partners/${r.body.id}`, { profitSharePct: 15 });
    expect(after.body).toMatchObject({ ownershipPct: 30, profitSharePct: 15 });
  });
});
