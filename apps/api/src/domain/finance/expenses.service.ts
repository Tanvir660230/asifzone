/**
 * Expenses and recurring commitments (ERP programme E7, docs/FINANCE_EXPENSES.md).
 *
 * An expense is an operating cost paid from a cash, bank or wallet account: a Treasury WITHDRAWAL (Dr the expense
 * account / Cr the money account — idempotent, with the account's approval threshold, the overdraft rule and reversal)
 * plus what the movement doesn't say: cost behaviour (FIXED / VARIABLE), payee, evidence, and the commitment period it
 * pays. Its state is its movement's state (awaiting approval, posted, rejected, reversed). An expense bought on credit is
 * a supplier bill (Phase 4E), not an expense here.
 *
 * A recurring commitment (rent, salaries, a subscription) posts nothing: it is a schedule — monthly, quarterly or yearly
 * on a day of the month. Each due period is PAID once an expense paying it posts, AWAITING APPROVAL while that payment
 * waits, otherwise DUE or OVERDUE; a rejected or reversed payment reopens the period. A period is paid at most once at a
 * time (checked under the commitment's row lock).
 */
import type { CostBehaviour, CommitmentFrequency, Prisma, TreasuryMovementStatus } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { nextFinanceSequence } from "./suppliers.service";
import { movementDto, requestMovementInTx } from "./treasury.service";
import { incomeStatement } from "./statements.service";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
export const expenseNumber = (n: number) => `EXP-${String(n).padStart(6, "0")}`;
const PAYING_KINDS = new Set(["CASH", "BANK", "MOBILE_WALLET"]);
const LIVE: TreasuryMovementStatus[] = ["PENDING_APPROVAL", "POSTED"];
const STEP: Record<CommitmentFrequency, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

// ── schedule ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const monthKey = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

/** The due dates of a commitment that fall in [from, to] (inclusive), each with its period key (YYYY-MM). */
export function dueDates(c: { frequency: CommitmentFrequency; dayOfMonth: number; startDate: string; endDate: string | null }, from: string, to: string) {
  const out: Array<{ periodKey: string; dueDate: string }> = [];
  const start = monthIndex(c.startDate);
  for (let i = start; i <= monthIndex(to); i += STEP[c.frequency]) {
    const due = `${monthKey(i)}-${String(c.dayOfMonth).padStart(2, "0")}`;
    if (due < c.startDate || (c.endDate && due > c.endDate) || due < from || due > to) continue;
    out.push({ periodKey: monthKey(i), dueDate: due });
  }
  return out;
}

/** Normalised to a month: the base of the break-even figure. */
const monthly = (amountMinor: number, f: CommitmentFrequency) => Math.round(amountMinor / STEP[f]);

// ── commitments ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CommitmentInput {
  name: string;
  expenseAccountId: string;
  amount: number;
  frequency: CommitmentFrequency;
  dayOfMonth: number;
  startDate: string;
  endDate?: string | null;
  costBehaviour?: CostBehaviour;
  payee?: string | null;
  supplierId?: string | null;
  financialAccountId?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

async function expenseAccount(tx: AppTransactionClient, businessId: string, id: string) {
  const a = await tx.ledgerAccount.findFirst({ where: { id, businessId } });
  if (!a) throw financeError(404, "ACCOUNT_NOT_FOUND", "Expense account not found");
  if (!a.isPostable || !a.isActive) throw financeError(400, "ACCOUNT_NOT_POSTABLE", `${a.code} ${a.name} can't take postings`);
  if (a.type !== "EXPENSE" && a.type !== "OTHER_EXPENSE") throw financeError(400, "ACCOUNT_TYPE", `${a.code} ${a.name} isn't an expense account`);
  return a;
}

const COMMITMENT_INCLUDE = {
  expenseAccount: { select: { id: true, code: true, name: true } },
  financialAccount: { select: { id: true, name: true } },
  supplier: { select: { id: true, displayName: true } },
  expenses: { select: { id: true, number: true, periodKey: true, amount: true, expenseDate: true, movement: { select: { status: true } } } },
} satisfies Prisma.RecurringCommitmentInclude;
type CommitmentRow = Prisma.RecurringCommitmentGetPayload<{ include: typeof COMMITMENT_INCLUDE }>;

function commitmentDto(c: CommitmentRow, cur: string, window: { from: string; to: string }, today: string) {
  const schedule = dueDates({ frequency: c.frequency, dayOfMonth: c.dayOfMonth, startDate: businessDateOf(c.startDate), endDate: c.endDate ? businessDateOf(c.endDate) : null }, window.from, window.to).map((d) => {
    const paying = c.expenses.filter((e) => e.periodKey === d.periodKey && LIVE.includes(e.movement.status));
    const posted = paying.find((e) => e.movement.status === "POSTED");
    const status = posted ? "PAID" : paying.length ? "AWAITING_APPROVAL" : d.dueDate < today ? "OVERDUE" : "DUE";
    const e = posted ?? paying[0];
    return { ...d, status, expense: e ? { id: e.id, number: expenseNumber(e.number), amount: toMajorNumber(toMinor(e.amount, cur), cur) } : null };
  });
  const amount = toMinor(c.amount, cur);
  return {
    id: c.id, name: c.name, expenseAccount: c.expenseAccount, amount: toMajorNumber(amount, cur), monthlyAmount: toMajorNumber(monthly(amount, c.frequency), cur),
    frequency: c.frequency, dayOfMonth: c.dayOfMonth, startDate: businessDateOf(c.startDate), endDate: c.endDate ? businessDateOf(c.endDate) : null,
    costBehaviour: c.costBehaviour, payee: c.payee, supplier: c.supplier, financialAccount: c.financialAccount, isActive: c.isActive, notes: c.notes,
    schedule, nextDue: schedule.find((s) => s.status !== "PAID") ?? null,
  };
}

function addMonths(date: string, n: number) {
  const i = monthIndex(date) + n;
  return `${monthKey(i)}-${date.slice(8, 10)}`;
}

async function validatedCommitment(tx: AppTransactionClient, businessId: string, input: CommitmentInput) {
  await expenseAccount(tx, businessId, input.expenseAccountId);
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 28) throw financeError(400, "COMMITMENT_DAY", "The due day is 1–28, so every month has it");
  if (input.endDate && input.endDate < input.startDate) throw financeError(400, "COMMITMENT_DATES", "The end is after the start");
  if (input.financialAccountId) {
    const fa = await tx.financialAccount.findFirst({ where: { id: input.financialAccountId, businessId } });
    if (!fa || !PAYING_KINDS.has(fa.kind)) throw financeError(400, "PAYMENT_SOURCE_KIND", "Pay commitments from cash, a bank or a wallet");
  }
  if (input.supplierId && !(await tx.supplier.findFirst({ where: { id: input.supplierId, businessId } }))) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
}

export async function createCommitment(input: CommitmentInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    await validatedCommitment(tx, business.id, input);
    const c = await tx.recurringCommitment.create({
      data: {
        businessId: business.id, name: input.name.trim(), expenseAccountId: input.expenseAccountId, amount: toDecimal(toMinor(input.amount, cur), cur), frequency: input.frequency,
        dayOfMonth: input.dayOfMonth, startDate: dateColumn(input.startDate), endDate: input.endDate ? dateColumn(input.endDate) : null, costBehaviour: input.costBehaviour ?? "FIXED",
        payee: input.payee ?? null, supplierId: input.supplierId ?? null, financialAccountId: input.financialAccountId ?? null, notes: input.notes ?? null,
      },
      include: COMMITMENT_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "commitment.create", entityType: "RecurringCommitment", entityId: c.id, after: { name: c.name, amount: input.amount, frequency: c.frequency, dayOfMonth: c.dayOfMonth } });
    const today = businessToday(business);
    return commitmentDto(c, cur, { from: addMonths(today, -3), to: addMonths(today, 3) }, today);
  });
}

/** Changes a commitment from now on — periods already paid keep the amount their expense paid. */
export async function updateCommitment(id: string, input: Partial<CommitmentInput>, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const before = await tx.recurringCommitment.findFirst({ where: { id, businessId: business.id } });
    if (!before) throw financeError(404, "COMMITMENT_NOT_FOUND", "Commitment not found");
    const merged: CommitmentInput = {
      name: input.name ?? before.name, expenseAccountId: input.expenseAccountId ?? before.expenseAccountId, amount: input.amount ?? toMajorNumber(toMinor(before.amount, cur), cur),
      frequency: input.frequency ?? before.frequency, dayOfMonth: input.dayOfMonth ?? before.dayOfMonth, startDate: input.startDate ?? businessDateOf(before.startDate),
      endDate: input.endDate !== undefined ? input.endDate : before.endDate ? businessDateOf(before.endDate) : null, costBehaviour: input.costBehaviour ?? before.costBehaviour,
      payee: input.payee !== undefined ? input.payee : before.payee, supplierId: input.supplierId !== undefined ? input.supplierId : before.supplierId,
      financialAccountId: input.financialAccountId !== undefined ? input.financialAccountId : before.financialAccountId, notes: input.notes !== undefined ? input.notes : before.notes,
      isActive: input.isActive ?? before.isActive,
    };
    await validatedCommitment(tx, business.id, merged);
    const c = await tx.recurringCommitment.update({
      where: { id },
      data: {
        name: merged.name.trim(), expenseAccountId: merged.expenseAccountId, amount: toDecimal(toMinor(merged.amount, cur), cur), frequency: merged.frequency, dayOfMonth: merged.dayOfMonth,
        startDate: dateColumn(merged.startDate), endDate: merged.endDate ? dateColumn(merged.endDate) : null, costBehaviour: merged.costBehaviour, payee: merged.payee ?? null,
        supplierId: merged.supplierId ?? null, financialAccountId: merged.financialAccountId ?? null, notes: merged.notes ?? null, isActive: merged.isActive,
      },
      include: COMMITMENT_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "commitment.update", entityType: "RecurringCommitment", entityId: id, before: { name: before.name, amount: toMajorNumber(toMinor(before.amount, cur), cur), isActive: before.isActive }, after: input });
    const today = businessToday(business);
    return commitmentDto(c, cur, { from: addMonths(today, -3), to: addMonths(today, 3) }, today);
  });
}

/** Active (or all) commitments with their schedule over a window (default: three months back to three ahead). */
export async function listCommitments(q: { from?: string; to?: string; includeInactive?: boolean } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const window = { from: q.from ?? addMonths(today, -3), to: q.to ?? addMonths(today, 3) };
  const rows = await prisma.recurringCommitment.findMany({ where: { businessId: business.id, ...(q.includeInactive ? {} : { isActive: true }) }, include: COMMITMENT_INCLUDE, orderBy: { name: "asc" } });
  const commitments = rows.map((c) => commitmentDto(c, cur, window, today));
  const active = rows.filter((c) => c.isActive && (!c.endDate || businessDateOf(c.endDate) >= today));
  const fixedMonthly = active.filter((c) => c.costBehaviour === "FIXED").reduce((s, c) => s + monthly(toMinor(c.amount, cur), c.frequency), 0);
  const variableMonthly = active.filter((c) => c.costBehaviour === "VARIABLE").reduce((s, c) => s + monthly(toMinor(c.amount, cur), c.frequency), 0);
  const all = commitments.flatMap((c) => c.schedule.map((s) => ({ ...s, commitmentId: c.id, name: c.name, amount: c.amount })));
  return {
    asOf: today, window, commitments,
    totals: { fixedMonthly: toMajorNumber(fixedMonthly, cur), variableMonthly: toMajorNumber(variableMonthly, cur) },
    overdue: all.filter((s) => s.status === "OVERDUE"),
    dueSoon: all.filter((s) => s.status === "DUE" && s.dueDate <= addMonths(today, 1)),
  };
}

// ── expenses ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ExpenseInput {
  expenseDate?: string;
  expenseAccountId?: string | null;
  amount?: number | null;
  costBehaviour?: CostBehaviour | null;
  payee?: string | null;
  description?: string | null;
  reference?: string | null;
  evidence?: string | null;
  fromFinancialAccountId?: string | null;
  /** Paying a commitment period: the account, amount, behaviour and money account default to the commitment's. */
  commitmentId?: string | null;
  periodKey?: string | null;
}

const EXPENSE_INCLUDE = {
  expenseAccount: { select: { id: true, code: true, name: true } },
  commitment: { select: { id: true, name: true } },
  movement: { select: { id: true, status: true, fromAccount: { select: { id: true, name: true } }, reversalReason: true, rejectionReason: true } },
} satisfies Prisma.ExpenseInclude;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

export function expenseDto(e: ExpenseRow, cur: string) {
  return {
    id: e.id, number: expenseNumber(e.number), expenseDate: businessDateOf(e.expenseDate), expenseAccount: e.expenseAccount, amount: toMajorNumber(toMinor(e.amount, cur), cur),
    costBehaviour: e.costBehaviour, payee: e.payee, description: e.description, reference: e.reference, evidence: e.evidence,
    commitment: e.commitment, periodKey: e.periodKey, status: e.movement.status, paidFrom: e.movement.fromAccount, movementId: e.movement.id,
    note: e.movement.rejectionReason ?? e.movement.reversalReason ?? null, createdAt: e.createdAt,
  };
}

/** Records (and, unless it needs approval, posts) an expense paid from a money account. Idempotent by the request key. */
export async function recordExpense(input: ExpenseInput, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every expense");
  const { business } = await getFinanceContext();
  return financeTransaction((tx) => recordExpenseInTx(tx, business, input, actor, idempotencyKey));
}

/** recordExpense in the caller's transaction (owner's books: an expense the owner paid personally is funded and paid in
 * one step). */
export async function recordExpenseInTx(tx: AppTransactionClient, business: FinanceBusinessInfo, input: ExpenseInput, actor: FinanceActor, idempotencyKey: string) {
  const cur = business.baseCurrency;
  const expenseDate = input.expenseDate ?? businessToday(business);
  if (business.openingDate && expenseDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  {
    let commitment = null;
    if (input.commitmentId) {
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "RecurringCommitment" WHERE id = ${input.commitmentId} AND "businessId" = ${business.id} FOR UPDATE`;
      if (!locked) throw financeError(404, "COMMITMENT_NOT_FOUND", "Commitment not found");
      commitment = await tx.recurringCommitment.findUniqueOrThrow({ where: { id: locked.id } });
      if (!input.periodKey) throw financeError(400, "COMMITMENT_PERIOD", "Name the period this pays");
      const due = dueDates({ frequency: commitment.frequency, dayOfMonth: commitment.dayOfMonth, startDate: businessDateOf(commitment.startDate), endDate: commitment.endDate ? businessDateOf(commitment.endDate) : null }, `${input.periodKey}-01`, `${input.periodKey}-31`);
      if (!due.length) throw financeError(400, "COMMITMENT_PERIOD", `${commitment.name} isn't due in ${input.periodKey}`);
    } else if (input.periodKey) {
      throw financeError(400, "COMMITMENT_PERIOD", "A period belongs to a commitment");
    }
    const accountId = input.expenseAccountId ?? commitment?.expenseAccountId;
    const fromId = input.fromFinancialAccountId ?? commitment?.financialAccountId;
    const amount = input.amount ?? (commitment ? toMajorNumber(toMinor(commitment.amount, cur), cur) : null);
    if (!accountId || !fromId || !amount) throw financeError(400, "EXPENSE_INCOMPLETE", "Give the expense account, the amount and the money account it is paid from");
    const account = await expenseAccount(tx, business.id, accountId);
    const from = await tx.financialAccount.findFirst({ where: { id: fromId, businessId: business.id } });
    if (!from) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "Money account not found");
    if (!PAYING_KINDS.has(from.kind)) throw financeError(400, "PAYMENT_SOURCE_KIND", `${from.name} is a clearing account — pay expenses from cash, a bank or a wallet`);
    const prior = await tx.treasuryMovement.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: `expense:${idempotencyKey}` } }, select: { id: true } });
    if (!prior && commitment) {
      const paid = await tx.expense.count({ where: { commitmentId: commitment.id, periodKey: input.periodKey!, movement: { status: { in: LIVE } } } });
      if (paid) throw financeError(409, "PERIOD_ALREADY_PAID", `${commitment.name} for ${input.periodKey} is already paid (or awaiting approval)`);
    }
    const description = input.description?.trim() || (commitment ? `${commitment.name} — ${input.periodKey}` : account.name);
    const { movement, replayed } = await requestMovementInTx(tx, business, {
      kind: "WITHDRAWAL", movementDate: expenseDate, amount, fromFinancialAccountId: from.id, counterAccountId: account.id,
      reference: input.reference ?? null, description: `${description}${input.payee ? ` · ${input.payee}` : ""}`.slice(0, 300),
    }, actor, `expense:${idempotencyKey}`);
    if (replayed) {
      const existing = await tx.expense.findUnique({ where: { movementId: movement.id }, include: EXPENSE_INCLUDE });
      if (!existing) throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This key was used for another money movement");
      return { expense: expenseDto(existing, cur), replayed: true };
    }
    const e = await tx.expense.create({
      data: {
        businessId: business.id, number: await nextFinanceSequence(tx, business.id, "expense"), expenseDate: dateColumn(expenseDate), expenseAccountId: account.id,
        amount: toDecimal(toMinor(amount, cur), cur), costBehaviour: input.costBehaviour ?? commitment?.costBehaviour ?? "VARIABLE", payee: input.payee ?? commitment?.payee ?? null,
        description, reference: input.reference ?? null, evidence: input.evidence ?? null, movementId: movement.id, commitmentId: commitment?.id ?? null,
        periodKey: commitment ? input.periodKey! : null, createdByAdminId: adminOf(actor),
      },
      include: EXPENSE_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "expense.record", entityType: "Expense", entityId: e.id, after: { ...expenseDto(e, cur), movement: movementDto(movement).status } });
    return { expense: expenseDto(e, cur), replayed: false };
  }
}

export async function listExpenses(q: { from?: string; to?: string; expenseAccountId?: string; costBehaviour?: CostBehaviour; commitmentId?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where: Prisma.ExpenseWhereInput = {
    businessId: business.id, expenseAccountId: q.expenseAccountId, costBehaviour: q.costBehaviour, commitmentId: q.commitmentId,
    ...(q.from || q.to ? { expenseDate: { ...(q.from ? { gte: dateColumn(q.from) } : {}), ...(q.to ? { lte: dateColumn(q.to) } : {}) } } : {}),
  };
  const [total, rows] = await Promise.all([prisma.expense.count({ where }), prisma.expense.findMany({ where, include: EXPENSE_INCLUDE, orderBy: [{ expenseDate: "desc" }, { number: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize })]);
  return { total, page: q.page, pageSize: q.pageSize, expenses: rows.map((r) => expenseDto(r, business.baseCurrency)) };
}

/** Posted expenses of a period by account and by behaviour, the fixed monthly commitments, and the break-even estimate
 * (fixed monthly costs ÷ the gross margin of the same period). */
export async function expenseSummary(q: { from?: string; to?: string }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const to = q.to ?? businessToday(business);
  const from = q.from ?? `${to.slice(0, 7)}-01`;
  const rows = await prisma.expense.findMany({ where: { businessId: business.id, expenseDate: { gte: dateColumn(from), lte: dateColumn(to) }, movement: { status: "POSTED" } }, include: { expenseAccount: { select: { id: true, code: true, name: true } } } });
  const byAccount = new Map<string, { account: { id: string; code: string; name: string }; fixed: number; variable: number }>();
  for (const r of rows) {
    const x = byAccount.get(r.expenseAccountId) ?? { account: r.expenseAccount, fixed: 0, variable: 0 };
    if (r.costBehaviour === "FIXED") x.fixed += toMinor(r.amount, cur);
    else x.variable += toMinor(r.amount, cur);
    byAccount.set(r.expenseAccountId, x);
  }
  const m = (n: number) => toMajorNumber(n, cur);
  const fixed = rows.filter((r) => r.costBehaviour === "FIXED").reduce((s, r) => s + toMinor(r.amount, cur), 0);
  const variable = rows.reduce((s, r) => s + toMinor(r.amount, cur), 0) - fixed;
  const commitments = await listCommitments();
  const income = await incomeStatement({ from, to });
  const margin = income.current.grossMarginPct;
  const fixedMonthly = Math.round(commitments.totals.fixedMonthly * 100);
  return {
    period: { from, to },
    accounts: [...byAccount.values()].map((x) => ({ account: x.account, fixed: m(x.fixed), variable: m(x.variable), total: m(x.fixed + x.variable) })).sort((a, b) => b.total - a.total),
    totals: { fixed: m(fixed), variable: m(variable), total: m(fixed + variable) },
    fixedMonthlyCommitments: commitments.totals.fixedMonthly,
    grossMarginPct: margin,
    /** Monthly revenue needed to cover the fixed commitments at this period's gross margin (null without a margin). */
    breakEvenMonthlyRevenue: margin && margin > 0 ? m(Math.round((fixedMonthly * 100) / margin)) : null,
  };
}
