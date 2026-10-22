/**
 * Financial statements (ERP programme E6, docs/FINANCE_STATEMENTS.md), computed from POSTED journal lines — the same sums
 * as the trial balance (ledger.service accountSums), so they always agree with it:
 *
 *   income statement   revenue − cost of goods sold = gross profit − operating expenses = operating profit
 *                      + other income − other expenses = net profit, for a period, with the prior period alongside
 *   balance sheet      assets = liabilities + equity, as at a date; profit not yet closed to retained earnings shows as
 *                      its own equity line, so the sheet balances whenever the books do
 *   cash flow          indirect: net profit + the change in every other balance-sheet account over the period, by
 *                      section (operating / investing / financing) = the change in money accounts (cash, bank, wallets,
 *                      gateway and courier clearing — every ledger account behind a money account)
 *
 * Accounts are grouped under their top-level group (the child of the type's root group). Sensitive accounts (ownership,
 * partners, payroll) are folded into one restricted line per section for viewers without finance.sensitive — totals stay
 * exact, nothing is attributed. Optional brand filter, as the trial balance.
 */
import type { LedgerAccount, LedgerAccountType } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeError, toMajorNumber, toMinor, FULL_VIEW, type FinanceViewer } from "./finance-values";
import { accountSums } from "./ledger.service";

interface Line { accountId: string | null; code: string; name: string; group: string; amount: number }
interface Section { key: string; label: string; lines: Line[]; total: number }

const PL_TYPES: LedgerAccountType[] = ["REVENUE", "COGS", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"];
const CREDIT_NATURE = new Set<LedgerAccountType>(["REVENUE", "OTHER_INCOME", "LIABILITY", "EQUITY"]);

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Each account's top-level group (the child of its root group) — the statement grouping. */
function topGroups(accounts: LedgerAccount[]) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out = new Map<string, LedgerAccount>();
  for (const a of accounts) {
    let cur = a;
    for (let i = 0; i < 20; i++) {
      const parent = cur.parentId ? byId.get(cur.parentId) : undefined;
      if (!parent || !parent.parentId) break; // `parent` is the root (or there is none): `cur` is the top-level group
      cur = parent;
    }
    out.set(a.id, cur);
  }
  return out;
}

async function load(range: { from?: string; to?: string; brandId?: string }) {
  const { business } = await getFinanceContext();
  const [sums, accounts] = await Promise.all([accountSums(business.id, range), prisma.ledgerAccount.findMany({ where: { businessId: business.id } })]);
  return { business, sums, accounts, groups: topGroups(accounts), byId: new Map(accounts.map((a) => [a.id, a])) };
}

/** Builds sections from per-account amounts (minor, already signed to the section's nature), folding sensitive ones. */
function sections(specs: Array<{ key: string; label: string; match: (a: LedgerAccount) => boolean }>, amounts: Map<string, number>, ctx: Awaited<ReturnType<typeof load>>, viewer: FinanceViewer, cur: string): Section[] {
  return specs.map((spec) => {
    const lines: Line[] = [];
    let restricted = 0;
    let any = false;
    for (const [id, amount] of amounts) {
      const a = ctx.byId.get(id)!;
      if (!spec.match(a) || amount === 0) continue;
      if (a.isSensitive && !viewer.sensitive) {
        restricted += amount;
        any = true;
        continue;
      }
      const g = ctx.groups.get(id)!;
      lines.push({ accountId: a.id, code: a.code, name: a.name, group: g.id === a.id ? a.name : g.name, amount });
    }
    if (any) lines.push({ accountId: null, code: "—", name: "Restricted accounts (ownership, partners, payroll)", group: "Restricted", amount: restricted });
    lines.sort((x, y) => x.code.localeCompare(y.code));
    const total = lines.reduce((s, l) => s + l.amount, 0);
    return { key: spec.key, label: spec.label, lines: lines.map((l) => ({ ...l, amount: toMajorNumber(l.amount, cur) })), total: toMajorNumber(total, cur) };
  });
}

async function profitAndLoss(range: { from: string; to: string; brandId?: string }, viewer: FinanceViewer) {
  const ctx = await load(range);
  const cur = ctx.business.baseCurrency;
  const amounts = new Map<string, number>();
  for (const s of ctx.sums) {
    const a = ctx.byId.get(s.accountId)!;
    if (!PL_TYPES.includes(a.type)) continue;
    const d = toMinor(s.periodDebit, cur), c = toMinor(s.periodCredit, cur);
    amounts.set(a.id, CREDIT_NATURE.has(a.type) ? c - d : d - c);
  }
  const secs = sections([
    { key: "revenue", label: "Revenue", match: (a) => a.type === "REVENUE" },
    { key: "cogs", label: "Cost of goods sold", match: (a) => a.type === "COGS" },
    { key: "expenses", label: "Operating expenses", match: (a) => a.type === "EXPENSE" },
    { key: "otherIncome", label: "Other income", match: (a) => a.type === "OTHER_INCOME" },
    { key: "otherExpenses", label: "Other expenses", match: (a) => a.type === "OTHER_EXPENSE" },
  ], amounts, ctx, viewer, cur);
  const t = (k: string) => Math.round(secs.find((s) => s.key === k)!.total * 100);
  const gross = t("revenue") - t("cogs");
  const operating = gross - t("expenses");
  const net = operating + t("otherIncome") - t("otherExpenses");
  const m = (n: number) => n / 100;
  return { sections: secs, grossProfit: m(gross), operatingProfit: m(operating), netProfit: m(net), grossMarginPct: t("revenue") ? Math.round((gross / t("revenue")) * 10_000) / 100 : null };
}

const lastDayOf = (ym: string) => addDays(`${shiftMonth(ym, 1)}-01`, -1);
function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const k = y * 12 + (m - 1) + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}

/**
 * The period to compare [from, to] with. A period that starts on the 1st is compared month for month: October with
 * September, October 1–22 with September 1–22, a quarter with the quarter before (a day past the shorter month's end is
 * its last day). Any other range: the same number of days just before it. Pure.
 */
export function priorPeriod(from: string, to: string): { from: string; to: string } {
  if (from.endsWith("-01")) {
    const n = (Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7))) - (Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7))) + 1;
    const toMonth = shiftMonth(to.slice(0, 7), -n);
    const end = lastDayOf(toMonth);
    const day = `${toMonth}-${to.slice(8, 10)}`;
    return { from: `${shiftMonth(from.slice(0, 7), -n)}-01`, to: to === lastDayOf(to.slice(0, 7)) || day > end ? end : day };
  }
  const len = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  const priorTo = addDays(from, -1);
  return { from: addDays(priorTo, -len), to: priorTo };
}

/** Income statement for [from, to], with the prior period (priorPeriod) alongside. */
export async function incomeStatement(q: { from?: string; to?: string; brandId?: string }, viewer: FinanceViewer = FULL_VIEW) {
  const { business } = await getFinanceContext();
  const to = q.to ?? businessToday(business);
  const from = q.from ?? `${to.slice(0, 7)}-01`;
  if (from > to) throw financeError(400, "PERIOD_RANGE", "The period starts before it ends");
  const { from: priorFrom, to: priorTo } = priorPeriod(from, to);
  const [current, prior] = await Promise.all([profitAndLoss({ from, to, brandId: q.brandId }, viewer), profitAndLoss({ from: priorFrom, to: priorTo, brandId: q.brandId }, viewer)]);
  return { currency: business.baseCurrency, period: { from, to }, prior: { from: priorFrom, to: priorTo }, brandId: q.brandId ?? null, current, priorPeriod: prior };
}

/** Balance sheet as at a date: assets = liabilities + equity (+ profit not yet closed to retained earnings). */
export async function balanceSheet(q: { asOf?: string; brandId?: string }, viewer: FinanceViewer = FULL_VIEW) {
  const { business } = await getFinanceContext();
  const asOf = q.asOf ?? businessToday(business);
  const ctx = await load({ to: asOf, brandId: q.brandId });
  const cur = ctx.business.baseCurrency;
  const amounts = new Map<string, number>();
  let unclosed = 0; // cumulative profit (income-statement accounts) not yet closed to retained earnings
  for (const s of ctx.sums) {
    const a = ctx.byId.get(s.accountId)!;
    const d = toMinor(s.periodDebit, cur), c = toMinor(s.periodCredit, cur);
    if (PL_TYPES.includes(a.type)) unclosed += c - d;
    else amounts.set(a.id, CREDIT_NATURE.has(a.type) ? c - d : d - c);
  }
  const secs = sections([
    { key: "assets", label: "Assets", match: (a) => a.type === "ASSET" },
    { key: "liabilities", label: "Liabilities", match: (a) => a.type === "LIABILITY" },
    { key: "equity", label: "Equity", match: (a) => a.type === "EQUITY" },
  ], amounts, ctx, viewer, cur);
  const equity = secs.find((s) => s.key === "equity")!;
  if (unclosed !== 0) {
    // profit never posted to retained earnings, split by fiscal year: earlier years' profit IS retained earnings; this
    // fiscal year's is current earnings (no closing journal, so period totals of income and expense stay intact)
    const startMonth = business.fiscalYearStartMonth;
    const fyYear = Number(asOf.slice(5, 7)) >= startMonth ? Number(asOf.slice(0, 4)) : Number(asOf.slice(0, 4)) - 1;
    const fyStart = `${fyYear}-${String(startMonth).padStart(2, "0")}-01`;
    let priorYears = 0;
    for (const s of (await load({ to: addDays(fyStart, -1), brandId: q.brandId })).sums) {
      if (PL_TYPES.includes(ctx.byId.get(s.accountId)!.type)) priorYears += toMinor(s.periodCredit, cur) - toMinor(s.periodDebit, cur);
    }
    const currentYear = unclosed - priorYears;
    if (priorYears !== 0) equity.lines.push({ accountId: null, code: "—", name: `Retained earnings — profit of fiscal years before ${fyStart}`, group: "Retained earnings", amount: toMajorNumber(priorYears, cur) });
    if (currentYear !== 0) equity.lines.push({ accountId: null, code: "—", name: `Profit for the fiscal year from ${fyStart}`, group: "Current earnings", amount: toMajorNumber(currentYear, cur) });
    equity.total = toMajorNumber(Math.round(equity.total * 100) + unclosed, cur);
  }
  const t = (k: string) => Math.round(secs.find((s) => s.key === k)!.total * 100);
  return {
    currency: cur, asOf, brandId: q.brandId ?? null, sections: secs,
    totalAssets: toMajorNumber(t("assets"), cur),
    totalLiabilitiesAndEquity: toMajorNumber(t("liabilities") + t("equity"), cur),
    balanced: t("assets") === t("liabilities") + t("equity"),
  };
}

/** Cash flow (indirect) for [from, to]: net profit + changes in non-money balance-sheet accounts = change in money. */
export async function cashFlow(q: { from?: string; to?: string; brandId?: string }, viewer: FinanceViewer = FULL_VIEW) {
  const { business } = await getFinanceContext();
  const to = q.to ?? businessToday(business);
  const from = q.from ?? `${to.slice(0, 7)}-01`;
  if (from > to) throw financeError(400, "PERIOD_RANGE", "The period starts before it ends");
  const ctx = await load({ from, to, brandId: q.brandId });
  const cur = ctx.business.baseCurrency;
  const moneyIds = new Set((await prisma.financialAccount.findMany({ where: { businessId: ctx.business.id }, select: { ledgerAccountId: true } })).map((f) => f.ledgerAccountId));
  let net = 0;
  let moneyOpen = 0;
  let moneyChange = 0;
  const changes = new Map<string, number>(); // cash effect: −Δ asset, +Δ liability / equity
  for (const s of ctx.sums) {
    const a = ctx.byId.get(s.accountId)!;
    const od = toMinor(s.openDebit, cur), oc = toMinor(s.openCredit, cur), pd = toMinor(s.periodDebit, cur), pc = toMinor(s.periodCredit, cur);
    if (PL_TYPES.includes(a.type)) { net += pc - pd; continue; }
    if (moneyIds.has(a.id)) { moneyOpen += od - oc; moneyChange += pd - pc; continue; }
    changes.set(a.id, pc - pd); // a debit-side increase (asset up) uses cash; a credit-side increase (liability / equity up) provides it
  }
  const code = (id: string) => ctx.groups.get(id)!.code;
  const investing = (a: LedgerAccount) => a.type === "ASSET" && code(a.id).startsWith("18");
  const financing = (a: LedgerAccount) => a.type === "EQUITY" || (a.type === "LIABILITY" && code(a.id).startsWith("25"));
  const secs = sections([
    { key: "operating", label: "Operating activities — working capital", match: (a) => !investing(a) && !financing(a) },
    { key: "investing", label: "Investing activities", match: investing },
    { key: "financing", label: "Financing activities", match: financing },
  ], changes, ctx, viewer, cur);
  const t = (k: string) => Math.round(secs.find((s) => s.key === k)!.total * 100);
  const explained = net + t("operating") + t("investing") + t("financing");
  return {
    currency: cur, period: { from, to }, brandId: q.brandId ?? null,
    netProfit: toMajorNumber(net, cur),
    sections: secs,
    operatingCashFlow: toMajorNumber(net + t("operating"), cur),
    netChange: toMajorNumber(explained, cur),
    money: { opening: toMajorNumber(moneyOpen, cur), change: toMajorNumber(moneyChange, cur), closing: toMajorNumber(moneyOpen + moneyChange, cur) },
    /** The statement explains the money accounts' change exactly when the books balance. */
    reconciles: explained === moneyChange,
  };
}
