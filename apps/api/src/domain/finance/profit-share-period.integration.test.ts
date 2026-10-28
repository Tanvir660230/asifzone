import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { cleanupFixtures, createStockedProduct, ownerId, purgeFinanceTables, RUN } from "../../test-fixtures";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { postOpeningBalances, saveOpeningInventory } from "./opening-balances.service";
import { postJournalInTx } from "./journal.service";
import { verifySharePeriod } from "./profit-share-period.service";

// A month is shared only once it is closed and a person has verified its profit; it is posted once at the rate in force
// for it; a failed posting isn't earned until it is in the books; later changes are corrections — up credited after
// approval, down never taken back; a duplicate or wrong posting is reversed only while it fits in what is owed
// (partner finance plan §7–§8, phase 3).

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
    put: (url: string, body: object = {}) => auth(request(app).put(`/api/v1/finance${url}`)).send(body),
  };
};
let bank = "";
let bank2 = "";
let bankLedger = "";
let acc: Record<string, string> = {};
let seq = 0;
const key = (n: string) => `psp-${n}-${++seq}-${RUN}`;
let A = { id: "", cur: "" };

async function journal(entryDate: string, debit: string, credit: string, amount: number, description: string) {
  const d = await api().post("/journals", { entryDate, description, lines: [{ accountId: debit, debit: amount, credit: 0 }, { accountId: credit, debit: 0, credit: amount }] }, key("j"));
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  expect((await api().post(`/journals/${d.body.journal.id}/post`)).status).toBe(200);
}
const sale = (date: string, amount: number) => journal(date, bankLedger, acc["4150"]!, amount, "sales");
const cost = (date: string, amount: number) => journal(date, acc["6100"]!, bankLedger, amount, "a cost");
async function periodId(month: string) {
  return (await prisma.financialPeriod.findFirstOrThrow({ where: { startDate: new Date(`${month}-01T00:00:00Z`) } })).id;
}
async function close(month: string) {
  const r = await api().post(`/periods/${await periodId(month)}/close`, { reason: "month done" });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}
async function share(month: string, profit: number) {
  expect((await api().post(`/equity/share-periods/${month}/prepare`)).body).toMatchObject({ status: "PREPARED", blocked: false, netProfit: profit });
  expect((await api().post(`/equity/share-periods/${month}/verify`, { confirmProfit: profit })).status).toBe(200);
  return (await api().post(`/equity/share-periods/${month}/post`)).body;
}
async function owed(p: { cur: string }) {
  const a = await prisma.journalLine.aggregate({ where: { accountId: p.cur, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return Number(a._sum.credit ?? 0) - Number(a._sum.debit ?? 0);
}
const shareOf = async (month: string) => prisma.profitShare.findUniqueOrThrow({ where: { partnerId_period: { partnerId: A.id, period: month } } });
/** A posting on A's account from before these rules (a fixture standing in for legacy data). */
async function extraCredit(amount: number, date: string) {
  const { business } = await getFinanceContext();
  const { entry } = await financeTransaction((tx) => postJournalInTx(tx, business, {
    entryDate: date, description: "share posted twice (fixture)", kind: "EVENT", sourceType: "TestFixture", idempotencyKey: key("dup"),
    lines: [{ accountId: acc["3350"]!, debit: amount * 100, credit: 0 }, { accountId: A.cur, debit: 0, credit: amount * 100 }],
  }, OWNER));
  return entry.id;
}

beforeAll(async () => {
  await purgeFinanceTables();
  admin = await ownerId();
  OWNER = { type: "ADMIN", adminId: admin, label: "owner@test", permissions: [...PERMISSIONS] };
  const ctx = await getFinanceContext();
  await ensureCommerceAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-01-01", reason: "books start" }, OWNER);
  const seed = await createStockedProduct({ stocks: [1], basePrice: 100 });
  await saveOpeningInventory([{ variantId: seed.variants[0]!.id, sku: "OB-PSP", name: "seed", quantity: 1, unitCost: 10, valuationStatus: "KNOWN", valuationMethod: "SUPPLIER_INVOICE", valuationSource: "INV", valuationDate: "2026-01-01", brandId: ctx.brand.id }], OWNER);
  await postOpeningBalances(OWNER);
  const mk = async (body: object) => { const r = await api().post("/financial-accounts", body); expect(r.status, JSON.stringify(r.body)).toBe(201); return r.body.id as string; };
  bank = await mk({ kind: "BANK", name: `PSP bank ${RUN}` });
  bank2 = await mk({ kind: "BANK", name: `PSP bank 2 ${RUN}`, approvalThreshold: 5000 });
  bankLedger = (await prisma.financialAccount.findUniqueOrThrow({ where: { id: bank }, select: { ledgerAccountId: true } })).ledgerAccountId;
  acc = Object.fromEntries(((await api().get("/accounts")).body.accounts as Array<{ id: string; code: string }>).map((a) => [a.code, a.id]));
  // the 3350 account is set up with the owner's books; a share run sets it up, so make sure it exists for the fixture
  await api().post("/equity/partners", { name: `Owner ${RUN}`, joinedOn: "2026-01-01", role: "OWNER" });
  acc = Object.fromEntries(((await api().get("/accounts")).body.accounts as Array<{ id: string; code: string }>).map((a) => [a.code, a.id]));
  const r = await api().post("/equity/partners", { name: `Rahim ${RUN}`, joinedOn: "2026-01-01", role: "WORKING", profitSharePct: 20, shareFrom: "2026-01-01" });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  A = { id: r.body.id, cur: r.body.currentAccount.id };
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("a month is shared once it is closed and verified, at its own rate", () => {
  it("T10/T11 January at 20%, a new 25% from February; a shared month can't get a new rate", async () => {
    await sale("2026-01-10", 10_000);
    await close("2026-01");
    const jan = await share("2026-01", 10_000);
    expect(jan.shared).toEqual([{ partner: `Rahim ${RUN}`, period: "2026-01", amount: 2_000 }]);
    expect((await api().post(`/equity/partners/${A.id}/rates`, { pct: 30, from: "2026-01" })).body.details.code).toBe("RATE_MONTH_SHARED");
    { const r25 = await api().post(`/equity/partners/${A.id}/rates`, { pct: 25, from: "2026-02" }); expect(r25.status, JSON.stringify(r25.body)).toBe(201); }
    await sale("2026-02-10", 10_000);
    await close("2026-02");
    await share("2026-02", 10_000);
    expect(Number((await shareOf("2026-01")).sharePct)).toBe(20);
    expect(Number((await shareOf("2026-02")).sharePct)).toBe(25);
    expect(Number((await shareOf("2026-02")).amount)).toBe(2_500);
    const rates = (await api().get(`/equity/partners/${A.id}/rates`)).body;
    expect(rates).toMatchObject({ firstOpenMonth: "2026-03", rates: [{ pct: 20, from: "2026-01" }, { pct: 25, from: "2026-02" }] });
    // changing the % on the partner starts it from the first month not shared yet
    expect((await api().patch(`/equity/partners/${A.id}`, { profitSharePct: 25 })).status).toBe(200);
  });

  it("T13 a month with money waiting for approval is blocked until it is decided; the profit must be typed exactly; the system can't verify", async () => {
    await sale("2026-03-10", 4_000);
    const pending = await api().post("/movements/withdrawal", { movementDate: "2026-03-15", amount: 6_000, description: "waiting", fromFinancialAccountId: bank2, counterAccountId: acc["6100"]! }, key("mv"));
    expect(pending.body.movement.status).toBe("PENDING_APPROVAL");
    await close("2026-03");
    const p = await api().post("/equity/share-periods/2026-03/prepare");
    expect(p.body).toMatchObject({ status: "PREPARED", blocked: true });
    expect((await api().post("/equity/share-periods/2026-03/verify", { confirmProfit: 4_000 })).body.details.code).toBe("PERIOD_BLOCKED");
    expect((await api().post(`/movements/${pending.body.movement.id}/reject`, { reason: "not this month" })).status).toBe(200);
    expect((await api().post("/equity/share-periods/2026-03/prepare")).body.blocked).toBe(false);
    expect((await api().post("/equity/share-periods/2026-03/verify", { confirmProfit: 3_999 })).body.details.code).toBe("PROFIT_NOT_CONFIRMED");
    await expect(verifySharePeriod("2026-03", { confirmProfit: 4_000 }, { type: "SYSTEM", label: "autopilot" })).rejects.toMatchObject({ details: { code: "VERIFY_BY_A_PERSON" } });
    expect((await api().post("/equity/share-periods/2026-03/post")).body.details.code).toBe("PERIOD_NOT_VERIFIED");
    expect((await api().post("/equity/share-periods/2026-03/verify", { confirmProfit: 4_000 })).status).toBe(200);
    const run = (await api().post("/equity/profit-shares/run", { through: "2026-03" })).body;
    expect(run.shared, JSON.stringify(run)).toEqual([{ partner: `Rahim ${RUN}`, period: "2026-03", amount: 1_000 }]);
  });

  it("T9 a share that fails to post isn't earned; a retry posts it once", async () => {
    await sale("2026-04-10", 8_000);
    await close("2026-04");
    const before = await owed(A);
    await setActive(A.cur, false); // the share journal will fail to post (ACCOUNT_INACTIVE)
    expect((await api().post("/equity/share-periods/2026-04/prepare")).status).toBe(200);
    expect((await api().post("/equity/share-periods/2026-04/verify", { confirmProfit: 8_000 })).status).toBe(200);
    const post = await api().post("/equity/share-periods/2026-04/post");
    expect(post.status, JSON.stringify(post.body)).toBe(200);
    expect(post.body.status).toBe("POSTING_FAILED");
    expect(post.body.lastError).toBeTruthy();
    expect(await owed(A)).toBe(before);
    expect((await api().get("/equity/profit-shares")).body.partners.find((p: { partnerId: string }) => p.partnerId === A.id).balances.finalizedEarnings).toBe(before);
    await setActive(A.cur, true);
    expect((await api().post("/equity/share-periods/2026-04/retry")).body.status).toBe("POSTED");
    expect(await owed(A)).toBe(before + 2_000);
    expect((await api().post("/equity/share-periods/2026-04/retry")).body.details.code).toBe("NOTHING_TO_RETRY");
  });
});

describe("corrections", () => {
  it("T14 a month's profit later lower: flagged for an accounting decision, nothing taken back", async () => {
    await sale("2026-05-10", 10_000);
    await close("2026-05");
    await share("2026-05", 10_000);
    const before = await owed(A);
    expect((await api().post(`/periods/${await periodId("2026-05")}/reopen`, { reason: "a late bill", acknowledgeShares: true })).status).toBe(200);
    await cost("2026-05-30", 5_000);
    await close("2026-05");
    expect((await api().post("/equity/share-periods/2026-05/prepare")).status).toBe(200);
    expect((await api().post("/equity/share-periods/2026-05/verify", { confirmProfit: 5_000 })).body.status).toBe("POSTED");
    const down = (await api().get(`/equity/adjustments?partnerId=${A.id}`)).body.adjustments.find((a: { period: string }) => a.period === "2026-05");
    expect(down, JSON.stringify(down)).toMatchObject({ kind: "PROFIT_RESTATEMENT_DOWN", status: "POLICY_REVIEW", amount: -1_250, sharePct: 25 });
    expect((await api().post(`/equity/adjustments/${down.id}/approve`)).body.details.code).toBe("ADJUSTMENT_NEEDS_POLICY");
    expect(await owed(A)).toBe(before);
  });

  it("T20 a share's journal can't be reversed or corrected by hand", async () => {
    const s = await shareOf("2026-01");
    const journal = await prisma.journalEntry.findFirstOrThrow({ where: { financialEventId: s.eventId! } });
    expect((await api().post(`/journals/${journal.id}/reverse`, { reason: "try" })).body.details.code).toBe("JOURNAL_OWNED_BY_PROFIT_SHARE");
    expect((await api().post(`/journals/${journal.id}/correct`, { reason: "try", lines: [{ accountId: acc["3350"]!, debit: 1, credit: 0 }, { accountId: bankLedger, debit: 0, credit: 1 }] })).body.details.code).toBe("JOURNAL_OWNED_BY_PROFIT_SHARE");
  });

  it("T25/T26 a duplicate posting not yet paid is reversed once, with its evidence", async () => {
    const entry = await extraCredit(1_000, "2026-10-01");
    const before = await owed(A);
    const prop = await api().post("/equity/adjustments", { kind: "DUPLICATE_POSTING", partnerId: A.id, relatedEntryId: entry, reason: "posted twice" });
    expect(prop.status, JSON.stringify(prop.body)).toBe(201);
    expect(prop.body).toMatchObject({ status: "PROPOSED", amount: -1_000 });
    const ok = await api().post(`/equity/adjustments/${prop.body.id}/approve`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe("POSTED");
    expect(await owed(A)).toBe(before - 1_000);
    expect((await api().post(`/equity/adjustments/${prop.body.id}/approve`)).body.details.code).toBe("ADJUSTMENT_NOT_PROPOSED");
    expect((await api().post("/equity/adjustments", { kind: "DUPLICATE_POSTING", partnerId: A.id, relatedEntryId: entry, reason: "again" })).status).toBe(409);
    const items = (await api().get(`/equity/partners/${A.id}/activity`)).body.items as Array<{ kind: string; amount: number }>;
    expect(items.some((i) => i.kind === "OTHER" && i.amount === -1_000)).toBe(true);
  });

  it("T27 a duplicate already paid out: an accounting decision, never a negative balance", async () => {
    const entry = await extraCredit(2_000, "2026-10-02");
    const all = await owed(A);
    expect((await api().post(`/equity/partners/${A.id}/pay`, { fromFinancialAccountId: bank, amount: all, method: "BANK", paymentDate: "2026-10-03" }, key("pay"))).status).toBe(201);
    const prop = await api().post("/equity/adjustments", { kind: "DUPLICATE_POSTING", partnerId: A.id, relatedEntryId: entry, reason: "posted twice, already paid" });
    expect(prop.body).toMatchObject({ status: "POLICY_REVIEW", amount: -2_000 });
    expect((await api().post(`/equity/adjustments/${prop.body.id}/approve`)).body.details.code).toBe("ADJUSTMENT_NEEDS_POLICY");
    expect(await owed(A)).toBe(0);
  });
});

describe("ad spend (blueprint P-6, Q16 = A)", () => {
  it("a month with a day of ad spend missing is blocked; confirming the quiet days as zero unblocks it", async () => {
    const ads = await api().post("/financial-accounts", { kind: "AD_PLATFORM", name: `PSP Meta ${RUN}`, provider: "Meta", accountReference: `act_psp_${RUN}` });
    expect(ads.status, JSON.stringify(ads.body)).toBe(201);
    const c = await api().post("/ads/campaigns", { financialAccountId: ads.body.id, name: `June push ${RUN}`, startDate: "2026-06-01", endDate: "2026-06-30" });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect((await api().put(`/ads/campaigns/${c.body.id}/spend`, { date: "2026-06-01", amount: 50 })).status).toBe(200);
    await sale("2026-06-10", 3_000);
    await close("2026-06");

    const p = (await api().post("/equity/share-periods/2026-06/prepare")).body;
    expect(p).toMatchObject({ status: "PREPARED", blocked: true });
    expect(p.readiness.steps.find((s: { key: string }) => s.key === "ads")).toMatchObject({ status: "TODO", blocking: true });
    expect((await api().post("/equity/share-periods/2026-06/verify", { confirmProfit: 2_950 })).body.details.code).toBe("PERIOD_BLOCKED");

    const rest = Array.from({ length: 29 }, (_, i) => `2026-06-${String(i + 2).padStart(2, "0")}`);
    const z = await api().post(`/ads/campaigns/${c.body.id}/confirm-zero`, { dates: rest, reason: "campaign paused after day one" });
    expect(z.status, JSON.stringify(z.body)).toBe(200);
    expect((await api().post("/equity/share-periods/2026-06/prepare")).body.blocked).toBe(false);
  });
});

/** Switches a ledger account on or off with its audit entry (the database requires one in the same transaction). */
async function setActive(accountId: string, isActive: boolean) {
  const { business } = await getFinanceContext();
  await financeTransaction(async (tx) => {
    await tx.ledgerAccount.update({ where: { id: accountId }, data: { isActive } });
    await recordFinanceAudit(tx, { businessId: business.id, actor: OWNER, action: "account.update", entityType: "LedgerAccount", entityId: accountId, after: { isActive }, reason: "test" });
  });
}
