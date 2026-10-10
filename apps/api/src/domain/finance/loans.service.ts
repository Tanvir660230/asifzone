/**
 * Loans (ERP programme E10, docs/FINANCE_LOANS.md).
 *
 *   drawdown    a Treasury DEPOSIT into cash / bank / wallet against liability.loans (the principal)
 *   interest    a monthly accrual run, once a month has ended, for every drawn loan — interest on each day's outstanding principal, actual/365,
 *               exact and half-even — ONE journal: Dr expense.interest / Cr liability.accrued_interest (each loan as
 *               party); months in order; only the latest run reversed
 *   repayment   pays accrued interest first, then principal: two Treasury WITHDRAWALs (against accrued interest and the
 *               loan liability) from the same money account; a repayment counts while its movements are posted
 *   schedule    the planned instalments (annuity or equal principal) — guidance; what is owed comes from the documents
 *
 * Outstanding principal = drawn − principal repaid; interest due = accrued − interest paid. Check loans.subledger ties
 * both to the ledger. Partner loans wait for the owner's partner / equity rules (B-2).
 */
import type { LoanRepaymentType, Prisma, TreasuryMovementStatus } from "@prisma/client";
import { LOAN_MAPPING_KEYS } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "./finance-audit";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { nextFinanceSequence } from "./suppliers.service";
import { chartState, provisionTemplateAccountsInTx } from "./chart-provisioning";
import { resolveMappedAccount } from "./chart.service";
import { postJournalInTx, reverseJournalInTx, type JournalLineSpec } from "./journal.service";
import { requestMovementInTx } from "./treasury.service";
import { divRound } from "./costing.service";
import { randomUUID } from "node:crypto";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
export const loanNumber = (n: number) => `LN-${String(n).padStart(3, "0")}`;
const PAYING_KINDS = new Set(["CASH", "BANK", "MOBILE_WALLET"]);
const LIVE: TreasuryMovementStatus[] = ["PENDING_APPROVAL", "POSTED"];
const DAY = 86_400_000;
const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
const monthKey = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const lastDay = (key: string) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY); // b − a
const rateScaled = (pct: number) => BigInt(Math.round(pct * 10_000)); // percent × 10⁴

/**
 * Interest (minor units) for the days [from, to] inclusive on a principal that steps down on repayment dates: actual/365,
 * Σ outstanding × days × rate, half-even once. `repayments` are (date, principal repaid); a repayment reduces the balance
 * from the day after it is paid.
 */
export function interestFor(principal: number, ratePct: number, from: string, to: string, repayments: Array<{ date: string; principal: number }>): number {
  if (to < from || ratePct === 0) return 0;
  let balance = principal - repayments.filter((r) => r.date < from).reduce((s, r) => s + r.principal, 0);
  let dayStart = from;
  let weighted = 0n; // Σ balance × days
  const steps = repayments.filter((r) => r.date >= from && r.date < to).sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const r of steps) {
    const segmentEnd = r.date; // the balance holds through the payment day
    weighted += BigInt(Math.max(0, balance)) * BigInt(daysBetween(dayStart, segmentEnd) + 1);
    balance -= r.principal;
    dayStart = addDays(r.date, 1);
  }
  weighted += BigInt(Math.max(0, balance)) * BigInt(daysBetween(dayStart, to) + 1);
  return Number(divRound(weighted * rateScaled(ratePct), 365n * 100n * 10_000n));
}

/** The planned instalments (guidance): annuity or equal principal, monthly from the first due date. Minor units. */
export function plannedSchedule(l: { principal: number; ratePct: number; termMonths: number; type: LoanRepaymentType; firstDueDate: string }) {
  const r = l.ratePct / 1200;
  const out: Array<{ n: number; dueDate: string; payment: number; interest: number; principal: number; balance: number }> = [];
  let balance = l.principal;
  const annuity = r === 0 ? Math.round(l.principal / l.termMonths) : Math.round((l.principal * r) / (1 - Math.pow(1 + r, -l.termMonths)));
  const flat = Math.round(l.principal / l.termMonths);
  const [y, m, d] = l.firstDueDate.split("-").map(Number) as [number, number, number];
  for (let n = 1; n <= l.termMonths; n++) {
    const due = new Date(Date.UTC(y, m - 1 + (n - 1), 1));
    const dim = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
    due.setUTCDate(Math.min(d, dim));
    const interest = Math.round(balance * r);
    let principal = l.type === "ANNUITY" ? annuity - interest : flat;
    if (n === l.termMonths || principal > balance) principal = balance; // the last instalment clears the rest
    balance -= principal;
    out.push({ n, dueDate: due.toISOString().slice(0, 10), payment: principal + interest, interest, principal, balance });
  }
  return out;
}

async function ensureSetup(tx: AppTransactionClient, business: Pick<FinanceBusinessInfo, "id">, actor: FinanceActor) {
  const audits: FinanceAuditInput[] = [];
  const { byCode, mapped } = await chartState(tx, business.id);
  await provisionTemplateAccountsInTx(tx, business, { needed: new Set<string>(LOAN_MAPPING_KEYS), byCode, mapped, audits, actor, reason: "Loans set-up" });
  if (audits.length) await recordFinanceAudit(tx, audits);
  const missing = LOAN_MAPPING_KEYS.filter((k) => !mapped.has(k));
  if (missing.length) throw financeError(409, "LOAN_MAPPINGS", `Map ${missing.join(", ")} in the chart first`);
}

const INCLUDE = {
  financialAccount: { select: { id: true, name: true } },
  drawdownMovement: { select: { status: true } },
  repayments: { orderBy: { paymentDate: "asc" }, include: { interestMovement: { select: { status: true } }, principalMovement: { select: { status: true } } } },
  accrualLines: { where: { run: { status: "POSTED" } }, select: { amount: true, run: { select: { periodKey: true } } } },
} satisfies Prisma.LoanInclude;
type LoanRow = Prisma.LoanGetPayload<{ include: typeof INCLUDE }>;

/** Posted (and, with `reserved`, awaiting approval) principal / interest repaid. */
function paid(l: LoanRow, cur: string, statuses: TreasuryMovementStatus[]) {
  const principal = l.repayments.filter((r) => r.principalMovement && statuses.includes(r.principalMovement.status));
  const interest = l.repayments.filter((r) => r.interestMovement && statuses.includes(r.interestMovement.status));
  return {
    principal: principal.reduce((s, r) => s + toMinor(r.principalPart, cur), 0),
    interest: interest.reduce((s, r) => s + toMinor(r.interestPart, cur), 0),
    principalSteps: principal.map((r) => ({ date: businessDateOf(r.paymentDate), principal: toMinor(r.principalPart, cur) })),
  };
}

export function loanDto(l: LoanRow, cur: string, today: string) {
  const m = (n: number) => toMajorNumber(n, cur);
  const drawn = l.drawdownMovement.status === "POSTED" ? toMinor(l.principal, cur) : 0;
  const posted = paid(l, cur, ["POSTED"]);
  const accrued = l.accrualLines.reduce((s, x) => s + toMinor(x.amount, cur), 0);
  const outstanding = drawn - posted.principal;
  const schedule = plannedSchedule({ principal: toMinor(l.principal, cur), ratePct: Number(l.annualRatePct), termMonths: l.termMonths, type: l.repaymentType, firstDueDate: businessDateOf(l.firstDueDate) });
  const status = l.drawdownMovement.status === "PENDING_APPROVAL" ? "AWAITING_APPROVAL" : l.drawdownMovement.status !== "POSTED" ? "CANCELLED" : outstanding <= 0 && accrued - posted.interest <= 0 ? "REPAID" : "ACTIVE";
  const next = schedule.find((s) => s.dueDate >= today);
  // overdue against the plan: the instalments due by today less everything repaid (posted), oldest first
  const repaid = posted.principal + posted.interest;
  let cumulative = 0;
  let since: string | null = null;
  let late = 0;
  if (status === "ACTIVE") {
    for (const x of schedule.filter((x) => x.dueDate <= today)) {
      cumulative += x.payment;
      if (cumulative > repaid) { since ??= x.dueDate; late += 1; }
    }
  }
  return {
    id: l.id, number: loanNumber(l.number), lender: l.lender, reference: l.reference, principal: m(toMinor(l.principal, cur)), annualRatePct: Number(l.annualRatePct),
    termMonths: l.termMonths, repaymentType: l.repaymentType, drawdownDate: businessDateOf(l.drawdownDate), firstDueDate: businessDateOf(l.firstDueDate),
    financialAccount: l.financialAccount, status, notes: l.notes,
    drawn: m(drawn), principalRepaid: m(posted.principal), outstanding: m(outstanding), interestAccrued: m(accrued), interestPaid: m(posted.interest), interestDue: m(accrued - posted.interest),
    lastAccruedMonth: l.accrualLines.map((x) => x.run.periodKey).sort().at(-1) ?? null,
    nextInstalment: next ? { dueDate: next.dueDate, payment: m(next.payment) } : null,
    overdue: { amount: m(Math.max(0, cumulative - repaid)), since, instalments: late },
    schedule: schedule.map((s) => ({ ...s, payment: m(s.payment), interest: m(s.interest), principal: m(s.principal), balance: m(s.balance) })),
    repayments: l.repayments.map((r) => ({ id: r.id, paymentDate: businessDateOf(r.paymentDate), interestPart: m(toMinor(r.interestPart, cur)), principalPart: m(toMinor(r.principalPart, cur)), reference: r.reference, status: r.principalMovement?.status ?? r.interestMovement?.status ?? "POSTED" })),
  };
}

export interface LoanInput {
  lender: string;
  reference?: string | null;
  principal: number;
  annualRatePct: number;
  termMonths: number;
  repaymentType?: LoanRepaymentType;
  drawdownDate: string;
  firstDueDate: string;
  financialAccountId: string;
  notes?: string | null;
}

async function payingAccount(tx: AppTransactionClient, businessId: string, id: string) {
  const fa = await tx.financialAccount.findFirst({ where: { id, businessId } });
  if (!fa) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "Money account not found");
  if (!PAYING_KINDS.has(fa.kind)) throw financeError(400, "PAYMENT_SOURCE_KIND", `${fa.name} is a clearing account — use cash, a bank or a wallet`);
  return fa;
}

/** Records a loan and its drawdown (money in). Idempotent by the request key. */
export async function drawLoan(input: LoanInput, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every loan");
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (business.openingDate && input.drawdownDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  if (input.firstDueDate <= input.drawdownDate) throw financeError(400, "LOAN_DATES", "The first instalment falls after the drawdown");
  return financeTransaction(async (tx) => {
    await ensureSetup(tx, business, actor);
    const fa = await payingAccount(tx, business.id, input.financialAccountId);
    const liability = await resolveMappedAccount(tx, business.id, "liability.loans");
    const { movement, replayed } = await requestMovementInTx(tx, business, {
      kind: "DEPOSIT", movementDate: input.drawdownDate, amount: input.principal, toFinancialAccountId: fa.id, counterAccountId: liability.id,
      reference: input.reference ?? null, description: `Loan from ${input.lender}`.slice(0, 300),
    }, actor, `loan:${idempotencyKey}`);
    if (replayed) {
      const existing = await tx.loan.findUnique({ where: { drawdownMovementId: movement.id }, include: INCLUDE });
      if (!existing) throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This key was used for another money movement");
      return { loan: loanDto(existing, cur, businessToday(business)), replayed: true };
    }
    const row = await tx.loan.create({
      data: {
        businessId: business.id, number: await nextFinanceSequence(tx, business.id, "loan"), lender: input.lender.trim(), reference: input.reference ?? null,
        principal: toDecimal(toMinor(input.principal, cur), cur), annualRatePct: input.annualRatePct.toFixed(4), termMonths: input.termMonths, repaymentType: input.repaymentType ?? "ANNUITY",
        drawdownDate: dateColumn(input.drawdownDate), firstDueDate: dateColumn(input.firstDueDate), financialAccountId: fa.id, drawdownMovementId: movement.id, notes: input.notes ?? null, createdByAdminId: adminOf(actor),
      },
      include: INCLUDE,
    });
    const dto = loanDto(row, cur, businessToday(business));
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "loan.draw", entityType: "Loan", entityId: row.id, after: { number: dto.number, lender: dto.lender, principal: dto.principal, ratePct: dto.annualRatePct, termMonths: dto.termMonths, drawdown: movement.status } });
    return { loan: dto, replayed: false };
  });
}

/** A repayment: accrued interest first, then principal — two money movements from one account. Idempotent by key. */
export async function repayLoan(id: string, input: { paymentDate?: string; amount: number; fromFinancialAccountId: string; reference?: string | null }, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every repayment");
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const paymentDate = input.paymentDate ?? businessToday(business);
  return financeTransaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Loan" WHERE id = ${id} AND "businessId" = ${business.id} FOR UPDATE`;
    if (!locked) throw financeError(404, "LOAN_NOT_FOUND", "Loan not found");
    const l = await tx.loan.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    const prior = await tx.treasuryMovement.findMany({ where: { businessId: business.id, idempotencyKey: { in: [`loan-repay:${idempotencyKey}:interest`, `loan-repay:${idempotencyKey}:principal`] } }, select: { id: true } });
    if (prior.length) {
      const r = await tx.loanRepayment.findFirst({ where: { OR: [{ interestMovementId: { in: prior.map((p) => p.id) } }, { principalMovementId: { in: prior.map((p) => p.id) } }] } });
      if (r) return { loan: loanDto(l, cur, businessToday(business)), repaymentId: r.id, replayed: true };
    }
    if (l.drawdownMovement.status !== "POSTED") throw financeError(409, "LOAN_NOT_DRAWN", "The loan's drawdown isn't posted");
    if (paymentDate < businessDateOf(l.drawdownDate)) throw financeError(400, "REPAYMENT_DATE", "A repayment falls after the drawdown");
    const fa = await payingAccount(tx, business.id, input.fromFinancialAccountId);
    const reserved = paid(l, cur, LIVE);
    const accrued = l.accrualLines.reduce((s, x) => s + toMinor(x.amount, cur), 0);
    const amount = toMinor(input.amount, cur);
    const interestPart = Math.max(0, Math.min(amount, accrued - reserved.interest));
    const principalPart = amount - interestPart;
    const outstanding = toMinor(l.principal, cur) - reserved.principal;
    if (amount <= 0) throw financeError(400, "REPAYMENT_AMOUNT", "A repayment is more than zero");
    if (principalPart > outstanding) throw financeError(409, "REPAYMENT_TOO_LARGE", `Only ${toMajorNumber(outstanding + interestPart, cur)} is owed (interest accrued so far ${toMajorNumber(interestPart, cur)} + principal ${toMajorNumber(outstanding, cur)})`);
    const label = `${loanNumber(l.number)} ${l.lender}`;
    const interestMove = interestPart ? (await requestMovementInTx(tx, business, {
      kind: "WITHDRAWAL", movementDate: paymentDate, amount: toMajorNumber(interestPart, cur), fromFinancialAccountId: fa.id, counterAccountId: (await resolveMappedAccount(tx, business.id, "liability.accrued_interest")).id,
      reference: input.reference ?? null, description: `Loan interest — ${label}`.slice(0, 300),
    }, actor, `loan-repay:${idempotencyKey}:interest`)).movement : null;
    const principalMove = principalPart ? (await requestMovementInTx(tx, business, {
      kind: "WITHDRAWAL", movementDate: paymentDate, amount: toMajorNumber(principalPart, cur), fromFinancialAccountId: fa.id, counterAccountId: (await resolveMappedAccount(tx, business.id, "liability.loans")).id,
      reference: input.reference ?? null, description: `Loan principal — ${label}`.slice(0, 300),
    }, actor, `loan-repay:${idempotencyKey}:principal`)).movement : null;
    const r = await tx.loanRepayment.create({
      data: { loanId: l.id, paymentDate: dateColumn(paymentDate), interestPart: toDecimal(interestPart, cur), principalPart: toDecimal(principalPart, cur), interestMovementId: interestMove?.id ?? null, principalMovementId: principalMove?.id ?? null, reference: input.reference ?? null, createdByAdminId: adminOf(actor) },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "loan.repay", entityType: "LoanRepayment", entityId: r.id, after: { loan: loanNumber(l.number), interestMinor: interestPart, principalMinor: principalPart, paymentDate } });
    const after = await tx.loan.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    return { loan: loanDto(after, cur, businessToday(business)), repaymentId: r.id, replayed: false };
  });
}

/** Accrues one month's interest on every drawn loan: one journal, once; months in order. */
export async function runInterestAccrual(periodKey: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw financeError(400, "PERIOD_KEY", "A month is YYYY-MM");
  const today = businessToday(business);
  if (periodKey >= today.slice(0, 7)) throw financeError(409, "MONTH_NOT_ENDED", "Interest is accrued once the month has ended (a month is accrued once)");
  return financeTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-loan-accrual:${business.id}`}))`;
    await ensureSetup(tx, business, actor);
    const existing = await tx.loanAccrualRun.findFirst({ where: { businessId: business.id, periodKey, status: "POSTED" }, include: { lines: true } });
    if (existing) return { run: runDto(existing, cur), replayed: true };
    const latest = await tx.loanAccrualRun.findFirst({ where: { businessId: business.id, status: "POSTED" }, orderBy: { periodKey: "desc" } });
    if (latest && periodKey < latest.periodKey) throw financeError(409, "MONTH_ALREADY_COVERED", `Interest already accrued through ${latest.periodKey}`);
    if (latest && monthIndex(periodKey) !== monthIndex(latest.periodKey) + 1) throw financeError(409, "RUN_IN_ORDER", `Accrue ${monthKey(monthIndex(latest.periodKey) + 1)} first — months run in order`);
    const monthStart = `${periodKey}-01`;
    const monthEnd = lastDay(periodKey);
    const loans = await tx.loan.findMany({ where: { businessId: business.id, drawdownMovement: { status: "POSTED" }, drawdownDate: { lte: dateColumn(monthEnd) } }, include: INCLUDE, orderBy: { number: "asc" } });
    const charges = loans
      .map((l) => {
        const from = businessDateOf(l.drawdownDate) > monthStart ? businessDateOf(l.drawdownDate) : monthStart;
        const to = monthEnd;
        return { l, amount: interestFor(toMinor(l.principal, cur), Number(l.annualRatePct), from, to, paid(l, cur, ["POSTED"]).principalSteps) };
      })
      .filter((x) => x.amount > 0);
    const total = charges.reduce((s, x) => s + x.amount, 0);
    const runId = randomUUID();
    let journalEntryId: string | null = null;
    if (charges.length) {
      const expense = await resolveMappedAccount(tx, business.id, "expense.interest");
      const accrued = await resolveMappedAccount(tx, business.id, "liability.accrued_interest");
      const lines: JournalLineSpec[] = [
        { accountId: expense.id, debit: total, credit: 0, memo: `Loan interest ${periodKey}` },
        ...charges.map((x) => ({ accountId: accrued.id, debit: 0, credit: x.amount, memo: `${loanNumber(x.l.number)} ${x.l.lender}`, partyType: "Loan", partyId: x.l.id })),
      ];
      const { entry } = await postJournalInTx(tx, business, { entryDate: monthEnd, description: `Loan interest ${periodKey}`, kind: "ADJUSTMENT", sourceType: "LoanAccrualRun", sourceId: runId, idempotencyKey: `loan-accrual:${runId}`, lines }, actor);
      journalEntryId = entry.id;
    }
    const run = await tx.loanAccrualRun.create({ data: { id: runId, businessId: business.id, periodKey, total: toDecimal(total, cur), journalEntryId, createdByAdminId: adminOf(actor) } });
    if (charges.length) await tx.loanAccrualLine.createMany({ data: charges.map((x) => ({ runId: run.id, loanId: x.l.id, amount: toDecimal(x.amount, cur) })) });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "loan.accrue", entityType: "LoanAccrualRun", entityId: run.id, after: { periodKey, totalMinor: total, loans: charges.length } });
    return { run: runDto(await tx.loanAccrualRun.findUniqueOrThrow({ where: { id: run.id }, include: { lines: true } }), cur), replayed: false };
  });
}

function runDto(r: Prisma.LoanAccrualRunGetPayload<{ include: { lines: true } }>, cur: string) {
  return { id: r.id, periodKey: r.periodKey, status: r.status, total: toMajorNumber(toMinor(r.total, cur), cur), loans: r.lines.length, createdAt: r.createdAt, reversalReason: r.reversalReason };
}

/** Reverses the latest accrual run — refused if interest it accrued has since been paid beyond what remains accrued. */
export async function reverseLatestAccrual(reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-loan-accrual:${business.id}`}))`;
    const latest = await tx.loanAccrualRun.findFirst({ where: { businessId: business.id, status: "POSTED" }, orderBy: { periodKey: "desc" }, include: { lines: true } });
    if (!latest) throw financeError(404, "NO_ACCRUAL_RUN", "No interest accrual to reverse");
    for (const line of latest.lines) {
      const l = await tx.loan.findUniqueOrThrow({ where: { id: line.loanId }, include: INCLUDE });
      const accrued = l.accrualLines.reduce((s, x) => s + toMinor(x.amount, cur), 0);
      if (paid(l, cur, LIVE).interest > accrued - toMinor(line.amount, cur)) throw financeError(409, "INTEREST_ALREADY_PAID", `Interest of ${loanNumber(l.number)} accrued in ${latest.periodKey} has been paid — reverse that repayment first`);
    }
    if (latest.journalEntryId) await reverseJournalInTx(tx, business, latest.journalEntryId, reason, businessToday(business) < lastDay(latest.periodKey) ? businessToday(business) : lastDay(latest.periodKey), actor);
    await tx.loanAccrualRun.update({ where: { id: latest.id }, data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "loan.accrual_reverse", entityType: "LoanAccrualRun", entityId: latest.id, before: { status: "POSTED" }, after: { status: "REVERSED" }, reason });
    return runDto(await tx.loanAccrualRun.findUniqueOrThrow({ where: { id: latest.id }, include: { lines: true } }), cur);
  });
}

export async function listLoans() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const rows = await prisma.loan.findMany({ where: { businessId: business.id }, include: INCLUDE, orderBy: { number: "desc" } });
  const loans = rows.map((l) => loanDto(l, cur, today));
  const active = loans.filter((l) => l.status === "ACTIVE");
  const runs = await prisma.loanAccrualRun.findMany({ where: { businessId: business.id }, include: { lines: true }, orderBy: { createdAt: "desc" }, take: 24 });
  const latest = runs.find((r) => r.status === "POSTED");
  const firstDraw = rows.filter((l) => l.drawdownMovement.status === "POSTED").map((l) => businessDateOf(l.drawdownDate).slice(0, 7)).sort()[0];
  const nextRun = latest ? monthKey(monthIndex(latest.periodKey) + 1) : firstDraw ?? null;
  const sum = (k: "outstanding" | "interestDue") => toMajorNumber(active.reduce((s, l) => s + toMinor(l[k], cur), 0), cur);
  return { asOf: today, loans, totals: { outstanding: sum("outstanding"), interestDue: sum("interestDue"), active: active.length }, nextAccrual: nextRun && nextRun < today.slice(0, 7) ? nextRun : null, runs: runs.map((r) => runDto(r, cur)) };
}
