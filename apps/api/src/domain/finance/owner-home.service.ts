/**
 * The owner's home (docs/FINANCE_OWNER_HOME.md): the four questions an owner asks, answered from the books in one call.
 *   1. How did the month go?   sales, and where each taka of it went — goods, delivery, ads, other costs, profit.
 *   2. Where is the money?     with whom (cash, bank, wallets), owed to us (courier, gateways, customers), in stock,
 *                              paid in advance.
 *   3. Who is owed what?       the owner's money in and out; each partner's share owed and the running month's estimate.
 *   4. What needs me?          only things with an action: a payout waiting, a partner to pay, a renewal, the books.
 * Every figure comes from the existing statements and services; nothing here posts.
 */
import { addDays } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { businessToday, getFinanceContext } from "./finance-context";
import { booksStarted } from "./finance-facts";
import { toMajorNumber, toMinor, type FinanceViewer } from "./finance-values";
import { incomeStatement } from "./statements.service";
import { moneyMap } from "./custody.service";
import { equityOverview, isBusinessOwner } from "./equity.service";
import { profitShareOverview } from "./partner-profit.service";
import { listRenewals } from "./finance-center.service";

type Month = { key: string; from: string; to: string };

function monthOf(key: string, today: string): Month {
  const from = `${key}-01`;
  const [y, m] = key.split("-").map(Number) as [number, number];
  const end = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`, -1);
  return { key, from, to: end < today ? end : today };
}
const previousKey = (key: string) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** A month's income statement folded into the owner's words. Costs are positive amounts. */
async function monthStory(month: Month, viewer: FinanceViewer, keyOf: Map<string, string>, cur: string) {
  const s = await incomeStatement({ from: month.from, to: month.to }, viewer);
  const cur_ = s.current;
  const section = (k: string) => cur_.sections.find((x) => x.key === k);
  const minor = (v: number) => toMinor(Math.abs(v), cur) * Math.sign(v);
  const sales = minor(section("revenue")?.total ?? 0);
  const goods = minor(section("cogs")?.total ?? 0);
  let delivery = 0, ads = 0, other = 0;
  for (const l of section("expenses")?.lines ?? []) {
    const key = l.accountId ? keyOf.get(l.accountId) : undefined;
    if (key === "expense.courier_fees" || key === "expense.freight_in") delivery += minor(l.amount);
    else if (key === "expense.advertising") ads += minor(l.amount);
    else other += minor(l.amount);
  }
  other += minor(section("otherExpenses")?.total ?? 0) - minor(section("otherIncome")?.total ?? 0);
  const profit = minor(cur_.netProfit);
  const m = (v: number) => toMajorNumber(v, cur);
  return { month: month.key, from: month.from, to: month.to, sales: m(sales), goods: m(goods), delivery: m(delivery), ads: m(ads), other: m(other), profit: m(profit) };
}

export async function ownerHome(q: { month?: string }, viewer: FinanceViewer) {
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const key = q.month ?? today.slice(0, 7);
  const started = await booksStarted(ctx);
  const mappings = await prisma.accountMapping.findMany({ where: { businessId: business.id }, select: { key: true, accountId: true } });
  const keyOf = new Map(mappings.map((x) => [x.accountId, x.key]));

  const [month, last, map] = await Promise.all([
    monthStory(monthOf(key, today), viewer, keyOf, cur),
    monthStory(monthOf(previousKey(key), today), viewer, keyOf, cur),
    moneyMap({}, viewer),
  ]);
  const t = map.totals;
  const money = {
    withUs: { cash: t.cash, bank: t.bank, wallets: t.wallets, total: toMajorNumber(toMinor(t.cash + t.bank + t.wallets, cur), cur) },
    owedToUs: { courier: t.courierReceivable, gateways: t.gatewayReceivable, customers: t.customerReceivables + t.otherReceivable },
    inBusiness: { stock: t.inventory + t.workInProgress, prepaid: t.prepaid, adAccounts: t.adAccounts },
    weOwe: { suppliers: t.suppliersOwed + t.goodsNotInvoiced, owner: t.ownerToRepay, loans: t.loans, storeCredit: t.storeCredit },
  };

  // People — only for the owner (finance.sensitive).
  let people: null | {
    owner: { name: string; putIn: number; takenOut: number; inBusiness: number } | null;
    partners: Array<{ id: string; name: string; sharePct: number | null; owed: number; earned: number; paid: number; runningMonth: { period: string; profitSoFar: number; shareSoFar: number } | null }>;
  } = null;
  if (viewer.sensitive) {
    const [eq, shares] = await Promise.all([equityOverview({}), profitShareOverview()]);
    const o = eq.partners.find((p) => isBusinessOwner(p.role));
    people = {
      owner: o ? { name: o.name, putIn: o.balances.capital, takenOut: -o.balances.current, inBusiness: o.balances.total } : null,
      partners: shares.partners.map((p) => ({ id: p.partnerId, name: p.name, sharePct: p.sharePct, owed: p.totals.owed, earned: p.totals.earned, paid: p.totals.paid, runningMonth: p.runningMonth })),
    };
  }

  // What needs the owner — each with where to do it.
  const todo: Array<{ kind: string; count?: number; amount?: number; name?: string; date?: string; partnerId?: string; href: string }> = [];
  if (!started) todo.push({ kind: "BOOKS_NOT_STARTED", href: "/admin/finance/opening" });
  const drafts = await prisma.clearingSettlement.findMany({ where: { businessId: business.id, status: "DRAFT" }, select: { netAmount: true } });
  if (drafts.length) todo.push({ kind: "PAYOUT_WAITING", count: drafts.length, amount: toMajorNumber(drafts.reduce((s, d) => s + toMinor(d.netAmount, cur), 0), cur), href: "/admin/finance/courier" });
  for (const p of people?.partners ?? []) if (p.owed > 0) todo.push({ kind: "PAY_PARTNER", name: p.name, amount: p.owed, partnerId: p.id, href: "/admin/finance/equity" });
  for (const r of await listRenewals()) {
    if (r.status === "RENEW_SOON" || r.status === "EXPIRED") todo.push({ kind: r.status === "EXPIRED" ? "EXPIRED" : "RENEW_SOON", name: r.name, date: r.serviceEnd, amount: r.renewalAmount ?? r.amount, href: "/admin/finance/prepaid" });
  }
  const pending = await prisma.treasuryMovement.count({ where: { businessId: business.id, status: "PENDING_APPROVAL" } });
  if (pending) todo.push({ kind: "APPROVE_MONEY", count: pending, href: "/admin/finance/attention" });

  return { currency: cur, today, booksStarted: started, month, lastMonth: last, money, people, todo };
}
