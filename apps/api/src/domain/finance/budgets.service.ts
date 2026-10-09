/**
 * Budgets, cash forecast and runway (ERP programme E12, docs/FINANCE_BUDGETS.md).
 *
 * Budget — a monthly plan per income-statement account (revenue, cost of goods sold, expenses, other income / expense),
 * each amount in the account's natural direction. Created empty or from the same months a year earlier ± a percentage;
 * edited freely (a plan, not a record — audited). Budget vs actual uses the same per-account sums as the income
 * statement, month by month and year to date, with the variance and whether it is favourable.
 *
 * Cash forecast — week by week for 13 weeks (or more) from today's balance in cash, bank and wallet accounts: + money in
 * transit (gateway / courier / manual-receipt clearing balances, expected in week 1), − supplier bills outstanding (by due
 * date; overdue in week 1), − recurring commitments not yet paid (by due date), − planned loan instalments, − open
 * purchase orders not yet received (at their expected date). Every line names its source; the running balance shows the
 * lowest point. Expected sales are not forecast — the forecast shows what is already known.
 *
 * Runway — months the cash lasts at the average monthly net change of the last three full months (null when not falling).
 */
import type { LedgerAccountType, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { businessDateOf, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { moneyBalanceAt } from "./ledger.service";
import { settlementOf } from "./supplier-payments.service";
import { dueDates } from "./expenses.service";
import { plannedSchedule } from "./loans.service";
import { payrollCashOutlook } from "./payroll.service";

const PL_TYPES: LedgerAccountType[] = ["REVENUE", "COGS", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"];
const INCOME = new Set<LedgerAccountType>(["REVENUE", "OTHER_INCOME"]);
const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
const monthKey = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const lastDay = (key: string) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
const monthsOf = (startMonth: string, months: number) => Array.from({ length: months }, (_, i) => monthKey(monthIndex(startMonth) + i));

/** Natural-direction actuals (minor) per account per month: revenue / other income credit − debit, costs debit − credit. */
async function actualsByMonth(businessId: string, cur: string, fromMonth: string, toMonth: string) {
  const rows = await prisma.$queryRaw<Array<{ accountId: string; type: LedgerAccountType; month: string; d: Prisma.Decimal; c: Prisma.Decimal }>>`
    SELECT l."accountId", a.type, to_char(e."entryDate", 'YYYY-MM') AS month, SUM(l.debit) AS d, SUM(l.credit) AS c
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "LedgerAccount" a ON a.id = l."accountId"
    WHERE e."businessId" = ${businessId} AND e.status = 'POSTED' AND a.type::text IN ('REVENUE', 'COGS', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE')
      AND e."entryDate" >= ${`${fromMonth}-01`}::date AND e."entryDate" <= ${lastDay(toMonth)}::date
    GROUP BY l."accountId", a.type, month`;
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const v = INCOME.has(r.type) ? toMinor(r.c, cur) - toMinor(r.d, cur) : toMinor(r.d, cur) - toMinor(r.c, cur);
    const m = out.get(r.accountId) ?? new Map<string, number>();
    m.set(r.month, (m.get(r.month) ?? 0) + v);
    out.set(r.accountId, m);
  }
  return out;
}

const BUDGET_INCLUDE = { lines: true } satisfies Prisma.BudgetInclude;

export async function listBudgets() {
  const { business } = await getFinanceContext();
  const rows = await prisma.budget.findMany({ where: { businessId: business.id }, orderBy: { startMonth: "desc" }, select: { id: true, name: true, startMonth: true, months: true, notes: true, updatedAt: true, _count: { select: { lines: true } } } });
  return { budgets: rows.map((b) => ({ id: b.id, name: b.name, startMonth: b.startMonth, months: b.months, endMonth: monthKey(monthIndex(b.startMonth) + b.months - 1), notes: b.notes, lines: b._count.lines, updatedAt: b.updatedAt })) };
}

/** A new budget, empty or from the same months a year earlier ± `adjustPct`. */
export async function createBudget(input: { name: string; startMonth: string; months?: number; copyFrom?: "LAST_YEAR" | null; adjustPct?: number; notes?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const months = input.months ?? 12;
  return financeTransaction(async (tx) => {
    if (await tx.budget.findUnique({ where: { businessId_name: { businessId: business.id, name: input.name.trim() } } })) throw financeError(409, "BUDGET_NAME_TAKEN", `A budget called "${input.name}" exists`);
    const b = await tx.budget.create({ data: { businessId: business.id, name: input.name.trim(), startMonth: input.startMonth, months, notes: input.notes ?? null, createdByAdminId: adminOf(actor) } });
    let copied = 0;
    if (input.copyFrom === "LAST_YEAR") {
      const from = monthKey(monthIndex(input.startMonth) - 12);
      const actuals = await actualsByMonth(business.id, cur, from, monthKey(monthIndex(from) + months - 1));
      const factor = 1 + (input.adjustPct ?? 0) / 100;
      const data: Prisma.BudgetLineCreateManyInput[] = [];
      for (const [accountId, byMonth] of actuals) {
        for (const [month, v] of byMonth) {
          const amount = Math.max(0, Math.round(v * factor));
          if (amount) data.push({ budgetId: b.id, accountId, periodKey: monthKey(monthIndex(month) + 12), amount: toDecimal(amount, cur) });
        }
      }
      if (data.length) await tx.budgetLine.createMany({ data });
      copied = data.length;
    }
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "budget.create", entityType: "Budget", entityId: b.id, after: { name: b.name, startMonth: b.startMonth, months, copyFrom: input.copyFrom ?? null, adjustPct: input.adjustPct ?? 0, lines: copied } });
    return { id: b.id, name: b.name, lines: copied };
  });
}

/** Sets amounts (natural direction; 0 removes the line) for accounts and months of a budget. */
export async function setBudgetLines(id: string, lines: Array<{ accountId: string; periodKey: string; amount: number }>, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const b = await tx.budget.findFirst({ where: { id, businessId: business.id } });
    if (!b) throw financeError(404, "BUDGET_NOT_FOUND", "Budget not found");
    const allowed = new Set(monthsOf(b.startMonth, b.months));
    const accounts = new Map((await tx.ledgerAccount.findMany({ where: { businessId: business.id, id: { in: [...new Set(lines.map((l) => l.accountId))] } } })).map((a) => [a.id, a]));
    for (const l of lines) {
      const a = accounts.get(l.accountId);
      if (!a || !PL_TYPES.includes(a.type) || !a.isPostable) throw financeError(400, "BUDGET_ACCOUNT", "Budgets plan income-statement accounts that take postings");
      if (!allowed.has(l.periodKey)) throw financeError(400, "BUDGET_MONTH", `${l.periodKey} is outside this budget`);
      if (l.amount < 0) throw financeError(400, "BUDGET_AMOUNT", "Amounts are zero or more");
      const amount = toMinor(l.amount, cur);
      if (amount === 0) await tx.budgetLine.deleteMany({ where: { budgetId: id, accountId: l.accountId, periodKey: l.periodKey } });
      else await tx.budgetLine.upsert({ where: { budgetId_accountId_periodKey: { budgetId: id, accountId: l.accountId, periodKey: l.periodKey } }, create: { budgetId: id, accountId: l.accountId, periodKey: l.periodKey, amount: toDecimal(amount, cur) }, update: { amount: toDecimal(amount, cur) } });
    }
    await tx.budget.update({ where: { id }, data: { updatedAt: new Date() } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "budget.set_lines", entityType: "Budget", entityId: id, after: { lines: lines.length } });
    return { id, updated: lines.length };
  });
}

/** Budget vs actual: per account, each month and year to date (through `through`, default the current month). */
export async function budgetVsActual(id: string, q: { through?: string } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const b = await prisma.budget.findFirst({ where: { id, businessId: business.id }, include: BUDGET_INCLUDE });
  if (!b) throw financeError(404, "BUDGET_NOT_FOUND", "Budget not found");
  const months = monthsOf(b.startMonth, b.months);
  const today = businessToday(business);
  const through = q.through ?? (today.slice(0, 7) < months[0]! ? months[0]! : today.slice(0, 7) > months.at(-1)! ? months.at(-1)! : today.slice(0, 7));
  const ytd = months.filter((m) => m <= through);
  const actuals = await actualsByMonth(business.id, cur, months[0]!, months.at(-1)!);
  const ids = new Set([...b.lines.map((l) => l.accountId), ...actuals.keys()]);
  const accounts = await prisma.ledgerAccount.findMany({ where: { id: { in: [...ids] } }, select: { id: true, code: true, name: true, type: true, isSensitive: true } });
  const planned = new Map<string, Map<string, number>>();
  for (const l of b.lines) {
    const m = planned.get(l.accountId) ?? new Map<string, number>();
    m.set(l.periodKey, toMinor(l.amount, cur));
    planned.set(l.accountId, m);
  }
  const major = (n: number) => toMajorNumber(n, cur);
  const rows = accounts
    .sort((a, b2) => a.code.localeCompare(b2.code))
    .map((a) => {
      const p = planned.get(a.id) ?? new Map<string, number>();
      const act = actuals.get(a.id) ?? new Map<string, number>();
      const budgetYtd = ytd.reduce((s, m) => s + (p.get(m) ?? 0), 0);
      const actualYtd = ytd.reduce((s, m) => s + (act.get(m) ?? 0), 0);
      const income = INCOME.has(a.type);
      const variance = actualYtd - budgetYtd;
      return {
        account: { id: a.id, code: a.code, name: a.name, type: a.type },
        months: months.map((m) => ({ periodKey: m, budget: major(p.get(m) ?? 0), actual: major(act.get(m) ?? 0) })),
        budgetYear: major(months.reduce((s, m) => s + (p.get(m) ?? 0), 0)),
        budgetYtd: major(budgetYtd), actualYtd: major(actualYtd), variance: major(variance),
        variancePct: budgetYtd ? Math.round((variance / budgetYtd) * 10_000) / 100 : null,
        favourable: variance === 0 ? null : income ? variance > 0 : variance < 0,
      };
    })
    .filter((r) => r.budgetYear !== 0 || r.actualYtd !== 0);
  const sum = (types: LedgerAccountType[], k: "budgetYtd" | "actualYtd" | "budgetYear") => rows.filter((r) => types.includes(r.account.type)).reduce((s, r) => s + Math.round(r[k] * 100), 0);
  const profit = (k: "budgetYtd" | "actualYtd" | "budgetYear") => sum(["REVENUE", "OTHER_INCOME"], k) - sum(["COGS", "EXPENSE", "OTHER_EXPENSE"], k);
  return {
    budget: { id: b.id, name: b.name, startMonth: b.startMonth, months: b.months, notes: b.notes },
    months, through, rows,
    totals: { netProfit: { budgetYear: major(profit("budgetYear")), budgetYtd: major(profit("budgetYtd")), actualYtd: major(profit("actualYtd")), variance: major(profit("actualYtd") - profit("budgetYtd")) } },
  };
}

export async function deleteBudget(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  await financeTransaction(async (tx) => {
    const b = await tx.budget.findFirst({ where: { id, businessId: business.id } });
    if (!b) throw financeError(404, "BUDGET_NOT_FOUND", "Budget not found");
    await tx.budget.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "budget.delete", entityType: "Budget", entityId: id, before: { name: b.name } });
  });
}

// ── cash forecast & runway ────────────────────────────────────────────────────────────────────────────────────────────

type ForecastLine = { date: string; week: number; source: "CLEARING" | "SUPPLIER_BILL" | "COMMITMENT" | "LOAN" | "PURCHASE_ORDER" | "PAYROLL"; label: string; amount: number; ref: string | null };

/** Week-by-week cash forecast from what is already known, and the runway at the recent burn rate. */
export async function cashForecast(q: { weeks?: number } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const weeks = Math.min(Math.max(q.weeks ?? 13, 1), 52);
  const today = businessToday(business);
  const end = addDays(today, weeks * 7 - 1);
  const weekOf = (date: string) => Math.max(1, Math.floor((Date.parse(`${(date < today ? today : date)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (7 * 86_400_000)) + 1);
  const accounts = await prisma.financialAccount.findMany({ where: { businessId: business.id, isActive: true }, select: { id: true, name: true, kind: true, ledgerAccountId: true } });
  let opening = 0;
  const lines: ForecastLine[] = [];
  const money: Array<{ name: string; kind: string; balance: number }> = [];
  for (const a of accounts) {
    const bal = await moneyBalanceAt(prisma, business.id, a.ledgerAccountId, cur, today);
    if (["CASH", "BANK", "MOBILE_WALLET"].includes(a.kind)) {
      opening += bal;
      money.push({ name: a.name, kind: a.kind, balance: toMajorNumber(bal, cur) });
    } else if (bal > 0) {
      lines.push({ date: today, week: 1, source: "CLEARING", label: `In transit — ${a.name}`, amount: bal, ref: a.id });
    }
  }
  // supplier bills outstanding, by due date
  const bills = await prisma.supplierInvoice.findMany({ where: { businessId: business.id, kind: "INVOICE", status: "POSTED", dueDate: { lte: new Date(`${end}T00:00:00Z`) } }, include: { supplier: { select: { displayName: true } } } });
  const settled = await settlementOf(prisma, bills.map((b) => b.id), cur);
  for (const b of bills) {
    const open = toMinor(b.total!, cur) - (settled.get(b.id)?.reserved ?? 0);
    if (open > 0) lines.push({ date: businessDateOf(b.dueDate), week: weekOf(businessDateOf(b.dueDate)), source: "SUPPLIER_BILL", label: `${b.supplier.displayName} · ${b.supplierRef}`, amount: -open, ref: b.id });
  }
  // recurring commitments not yet paid (overdue ones from the last 3 months land in week 1)
  const commitments = await prisma.recurringCommitment.findMany({ where: { businessId: business.id, isActive: true }, include: { expenses: { select: { periodKey: true, movement: { select: { status: true } } } } } });
  for (const c of commitments) {
    for (const d of dueDates({ frequency: c.frequency, dayOfMonth: c.dayOfMonth, startDate: businessDateOf(c.startDate), endDate: c.endDate ? businessDateOf(c.endDate) : null }, addDays(today, -92), end)) {
      if (c.expenses.some((e) => e.periodKey === d.periodKey && ["PENDING_APPROVAL", "POSTED"].includes(e.movement.status))) continue;
      lines.push({ date: d.dueDate, week: weekOf(d.dueDate), source: "COMMITMENT", label: `${c.name} — ${d.periodKey}`, amount: -toMinor(c.amount, cur), ref: c.id });
    }
  }
  // planned loan instalments (active loans)
  const loans = await prisma.loan.findMany({ where: { businessId: business.id, drawdownMovement: { status: "POSTED" } } });
  for (const l of loans) {
    for (const s of plannedSchedule({ principal: toMinor(l.principal, cur), ratePct: Number(l.annualRatePct), termMonths: l.termMonths, type: l.repaymentType, firstDueDate: businessDateOf(l.firstDueDate) })) {
      if (s.dueDate < today || s.dueDate > end) continue;
      lines.push({ date: s.dueDate, week: weekOf(s.dueDate), source: "LOAN", label: `Loan instalment — ${l.lender}`, amount: -s.payment, ref: l.id });
    }
  }
  // payroll: net pay of runs not yet paid (at their pay date), then the standard monthly net of current staff at each
  // month end the window reaches that has no run yet (an estimate, labelled so)
  const payroll = await payrollCashOutlook(business.id, cur, today);
  for (const r of payroll.unpaid) lines.push({ date: r.payDate, week: weekOf(r.payDate), source: "PAYROLL", label: `Salaries ${r.periodKey} (${r.number}${r.status === "DRAFT" ? ", draft" : ""})`, amount: -r.amount, ref: null });
  if (payroll.monthlyNet > 0) {
    for (let i = monthIndex(today.slice(0, 7)); lastDay(monthKey(i)) <= end; i++) {
      const key = monthKey(i);
      if (payroll.coveredMonths.has(key)) continue;
      lines.push({ date: lastDay(key), week: weekOf(lastDay(key)), source: "PAYROLL", label: `Salaries ${key} (estimate)`, amount: -payroll.monthlyNet, ref: null });
    }
  }
  // open purchase orders: what is ordered and not yet received, at the expected date (or in two weeks)
  const pos = await prisma.purchaseOrder.findMany({ where: { businessId: business.id, status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } }, include: { supplier: { select: { displayName: true, paymentTermsDays: true } }, lines: { select: { qtyOrdered: true, qtyReceived: true, unitPrice: true, lineType: true } } } });
  for (const po of pos) {
    const open = po.lines.filter((l) => l.lineType === "STOCK").reduce((s, l) => s + Math.max(0, l.qtyOrdered - l.qtyReceived) * toMinor(l.unitPrice, cur), 0);
    if (!open) continue;
    const date = addDays(po.expectedDate ? businessDateOf(po.expectedDate) : addDays(today, 14), po.supplier.paymentTermsDays);
    if (date > end) continue;
    lines.push({ date, week: weekOf(date), source: "PURCHASE_ORDER", label: `PO-${String(po.number).padStart(6, "0")} ${po.supplier.displayName} (to pay when billed)`, amount: -open, ref: po.id });
  }
  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let running = opening;
  let lowest = { balance: opening, week: 0, date: today };
  const byWeek = Array.from({ length: weeks }, (_, i) => {
    const week = i + 1;
    const items = lines.filter((l) => l.week === week);
    const inflow = items.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
    const outflow = items.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0);
    running += inflow - outflow;
    if (running < lowest.balance) lowest = { balance: running, week, date: addDays(today, week * 7 - 1) };
    return { week, from: addDays(today, i * 7), to: addDays(today, i * 7 + 6), inflow: toMajorNumber(inflow, cur), outflow: toMajorNumber(outflow, cur), closing: toMajorNumber(running, cur) };
  });
  // runway: the average monthly change of cash, bank and wallets over the last three full months
  const thisMonth = monthIndex(today.slice(0, 7));
  const paying = accounts.filter((a) => ["CASH", "BANK", "MOBILE_WALLET"].includes(a.kind));
  const balanceAt = async (date: string) => { let t = 0; for (const a of paying) t += await moneyBalanceAt(prisma, business.id, a.ledgerAccountId, cur, date); return t; };
  const startBal = await balanceAt(lastDay(monthKey(thisMonth - 4)));
  const endBal = await balanceAt(lastDay(monthKey(thisMonth - 1)));
  const monthlyChange = Math.round((endBal - startBal) / 3);
  return {
    asOf: today, weeks, currency: cur,
    opening: toMajorNumber(opening, cur), money,
    lines: lines.map((l) => ({ ...l, amount: toMajorNumber(l.amount, cur) })),
    byWeek, closing: toMajorNumber(running, cur),
    lowest: { balance: toMajorNumber(lowest.balance, cur), week: lowest.week, date: lowest.date },
    runway: { averageMonthlyChange: toMajorNumber(monthlyChange, cur), months: monthlyChange < 0 && opening > 0 ? Math.round((opening / -monthlyChange) * 10) / 10 : null, basis: `${monthKey(thisMonth - 3)} to ${monthKey(thisMonth - 1)}` },
  };
}
