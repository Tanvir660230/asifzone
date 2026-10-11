/**
 * Bank reconciliation (Financial Core Phase 2, docs/FINANCE_PHASE_2.md §6). A run compares one statement period of one
 * money account with the books. It never changes a balance: differences are explained by matching, by outstanding items
 * (timing — a cheque the bank hasn't cleared), or resolved by an explicit, journaled adjustment.
 *
 * For a run over [periodStart, periodEnd] with statement balances O (opening) and C (closing):
 *   statementGap          = O + Σ statement lines in the period − C              (must be 0: the statement is complete)
 *   difference            = C − ledger balance at periodEnd                        (reported as is)
 *   outstanding ledger    = Σ unmatched remainders of posted ledger lines on the account dated in [start, periodEnd]
 *   unmatched statement   = Σ unmatched remainders of statement lines dated in [start, periodEnd], not yet reconciled
 *   unexplainedDifference = (ledger − C) − (outstanding ledger − unmatched statement)
 * where `start` is the account's reconciliation start (the first completed run's periodStart; lines before it are covered
 * by that run's opening statement balance). A run COMPLETES only with statementGap = 0, every statement line of the period
 * fully matched, and unexplainedDifference = 0; its statement lines then become RECONCILED (final), and the run is frozen.
 * Runs of an account chain: each opens the day after the previous completed one closed, with its closing balance.
 */
import type { BankReconciliation, Prisma } from "@prisma/client";
import { addDays } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "./finance-audit";
import { getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { bankTransactionDto, matchInTx, outstandingLines } from "./bank.service";
import { moneyBalanceAt } from "./ledger.service";

const adminId = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
const signedMinor = (v: number, cur: string) => toDecimal(v, cur);
/** A signed major-unit input → signed minor units. */
const toSignedMinor = (v: number, cur: string) => Math.sign(v) * toMinor(Math.abs(v), cur);

interface Computed {
  ledgerOpeningBalance: number;
  ledgerBalance: number;
  statementMovement: number;
  difference: number;
  unexplainedDifference: number;
  statementGap: number;
  outstandingLedgerNet: number;
  unmatchedStatementNet: number;
  matchedCount: number;
  unmatchedCount: number;
  outstandingLedgerCount: number;
  adjustmentCount: number;
}

async function compute(db: AppTransactionClient | typeof prisma, business: FinanceBusinessInfo, run: BankReconciliation) {
  const cur = business.baseCurrency;
  const fa = await db.financialAccount.findUniqueOrThrow({ where: { id: run.financialAccountId } });
  const periodStart = businessDateOf(run.periodStart);
  const periodEnd = businessDateOf(run.periodEnd);
  const start = fa.reconciliationStartDate ? businessDateOf(fa.reconciliationStartDate) : periodStart;
  const [ledgerOpeningBalance, ledgerBalance] = await Promise.all([
    moneyBalanceAt(db, business.id, fa.ledgerAccountId, cur, addDays(periodStart, -1)),
    moneyBalanceAt(db, business.id, fa.ledgerAccountId, cur, periodEnd),
  ]);
  const lines = await db.bankTransaction.findMany({
    where: { financialAccountId: fa.id, transactionDate: { gte: dateColumn(start < periodStart ? start : periodStart), lte: run.periodEnd } },
    orderBy: [{ transactionDate: "asc" }, { importLine: "asc" }, { createdAt: "asc" }],
    include: { matches: { where: { status: "ACTIVE" }, include: { journalLine: { select: { id: true, entry: { select: { number: true, entryDate: true, description: true } } } } } } },
  });
  const inPeriod = lines.filter((l) => l.transactionDate >= run.periodStart);
  // A statement line counts as matched for THIS period only by ledger lines the books dated by periodEnd: one the books
  // recorded later is, for this period, still money the bank has and the books don't.
  const remainderOf = (l: (typeof lines)[number]) =>
    Math.abs(toMinor(l.amount, cur)) - l.matches.filter((m) => m.journalLine.entry.entryDate <= run.periodEnd).reduce((s, m) => s + toMinor(m.amount, cur), 0);
  const sign = (l: (typeof lines)[number]) => (toMinor(l.amount, cur) > 0 ? 1 : -1);
  const statementMovement = inPeriod.reduce((s, l) => s + toMinor(l.amount, cur), 0);
  const unmatchedStatementNet = lines.filter((l) => !l.reconciliationId).reduce((s, l) => s + sign(l) * remainderOf(l), 0);
  const outstanding = await outstandingLines(business.id, fa.ledgerAccountId, cur, { from: start, to: periodEnd, matchedBy: periodEnd }, db);
  const outstandingLedgerNet = outstanding.reduce((s, l) => s + (l.debit > 0 ? l.remainingMinor : -l.remainingMinor), 0);
  const closing = toMinor(run.closingStatementBalance, cur);
  const opening = toMinor(run.openingStatementBalance, cur);
  const adjustmentCount = await db.treasuryMovement.count({
    where: { kind: "ADJUSTMENT", status: "POSTED", OR: [{ reconciliationId: run.id }, { bankTransactionId: { in: inPeriod.map((l) => l.id) } }] },
  });
  const c: Computed = {
    ledgerOpeningBalance,
    ledgerBalance,
    statementMovement,
    difference: closing - ledgerBalance,
    unexplainedDifference: ledgerBalance - closing - (outstandingLedgerNet - unmatchedStatementNet),
    statementGap: opening + statementMovement - closing,
    outstandingLedgerNet,
    unmatchedStatementNet,
    matchedCount: inPeriod.filter((l) => remainderOf(l) === 0).length,
    unmatchedCount: inPeriod.filter((l) => remainderOf(l) > 0).length,
    outstandingLedgerCount: outstanding.length,
    adjustmentCount,
  };
  return { c, fa, inPeriod, outstanding, earlierUnreconciled: lines.filter((l) => l.transactionDate < run.periodStart && !l.reconciliationId && remainderOf(l) > 0).length };
}

function snapshotData(c: Computed, cur: string) {
  return {
    ledgerOpeningBalance: signedMinor(c.ledgerOpeningBalance, cur),
    ledgerBalance: signedMinor(c.ledgerBalance, cur),
    statementMovement: signedMinor(c.statementMovement, cur),
    difference: signedMinor(c.difference, cur),
    unexplainedDifference: signedMinor(c.unexplainedDifference, cur),
    statementGap: signedMinor(c.statementGap, cur),
    matchedCount: c.matchedCount,
    unmatchedCount: c.unmatchedCount,
    outstandingLedgerCount: c.outstandingLedgerCount,
    adjustmentCount: c.adjustmentCount,
  };
}

function runDto(r: BankReconciliation, cur: string) {
  const major = (v: Prisma.Decimal | null) => (v === null ? null : toMajorNumber(toMinor(v, cur), cur));
  return {
    id: r.id,
    financialAccountId: r.financialAccountId,
    status: r.status,
    periodStart: businessDateOf(r.periodStart),
    periodEnd: businessDateOf(r.periodEnd),
    openingStatementBalance: major(r.openingStatementBalance),
    closingStatementBalance: major(r.closingStatementBalance),
    ledgerOpeningBalance: major(r.ledgerOpeningBalance),
    ledgerBalance: major(r.ledgerBalance),
    statementMovement: major(r.statementMovement),
    difference: major(r.difference),
    unexplainedDifference: major(r.unexplainedDifference),
    statementGap: major(r.statementGap),
    matchedCount: r.matchedCount,
    unmatchedCount: r.unmatchedCount,
    outstandingLedgerCount: r.outstandingLedgerCount,
    adjustmentCount: r.adjustmentCount,
    notes: r.notes,
    startedByAdminId: r.startedByAdminId,
    completedByAdminId: r.completedByAdminId,
    completedAt: r.completedAt,
    abandonedAt: r.abandonedAt,
    abandonReason: r.abandonReason,
    createdAt: r.createdAt,
  };
}

async function lockRun(tx: AppTransactionClient, businessId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "BankReconciliation" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "RECONCILIATION_NOT_FOUND", "Reconciliation not found");
  return tx.bankReconciliation.findUniqueOrThrow({ where: { id } });
}

export async function startReconciliation(input: { financialAccountId: string; periodStart: string; periodEnd: string; openingStatementBalance: number; closingStatementBalance: number }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const fa = await tx.financialAccount.findFirst({ where: { id: input.financialAccountId, businessId: business.id } });
    if (!fa) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "Financial account not found");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-recon:${fa.id}`}))`;
    const open = await tx.bankReconciliation.findFirst({ where: { financialAccountId: fa.id, status: "IN_PROGRESS" } });
    if (open) throw financeError(409, "RECONCILIATION_IN_PROGRESS", "This account already has a reconciliation in progress — finish or abandon it", { reconciliationId: open.id });
    const last = await tx.bankReconciliation.findFirst({ where: { financialAccountId: fa.id, status: "COMPLETED" }, orderBy: { periodEnd: "desc" } });
    if (last) {
      const expectedStart = addDays(businessDateOf(last.periodEnd), 1);
      if (input.periodStart !== expectedStart) throw financeError(409, "RECONCILIATION_CHAIN", `The next reconciliation of ${fa.name} starts on ${expectedStart}`, { expectedStart });
      const expectedOpening = toMinor(last.closingStatementBalance, cur);
      if (toSignedMinor(input.openingStatementBalance, cur) !== expectedOpening) {
        throw financeError(409, "RECONCILIATION_CHAIN", `The statement must open with the previous closing balance (${toMajorNumber(expectedOpening, cur)})`, { expectedOpening: toMajorNumber(expectedOpening, cur) });
      }
    }
    const signed = (v: number) => toDecimal(toSignedMinor(v, cur), cur);
    const run = await tx.bankReconciliation.create({
      data: {
        businessId: business.id,
        financialAccountId: fa.id,
        periodStart: dateColumn(input.periodStart),
        periodEnd: dateColumn(input.periodEnd),
        openingStatementBalance: signed(input.openingStatementBalance),
        closingStatementBalance: signed(input.closingStatementBalance),
        startedByAdminId: adminId(actor),
      },
    });
    const { c } = await compute(tx, business, run);
    const after = await tx.bankReconciliation.update({ where: { id: run.id }, data: snapshotData(c, cur) });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "bank_reconciliation.start", entityType: "BankReconciliation", entityId: run.id, after: runDto(after, cur) });
    return runDto(after, cur);
  });
}

/** The run with its live figures (IN_PROGRESS) or its frozen snapshot (COMPLETED / ABANDONED), and the lines to work on. */
export async function getReconciliation(id: string) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const run = await prisma.bankReconciliation.findFirst({ where: { id, businessId: business.id } });
  if (!run) throw financeError(404, "RECONCILIATION_NOT_FOUND", "Reconciliation not found");
  const { c, inPeriod, outstanding, earlierUnreconciled } = await compute(prisma, business, run);
  const live = run.status === "IN_PROGRESS";
  const lines = await prisma.bankTransaction.findMany({
    where: { id: { in: inPeriod.map((l) => l.id) } },
    orderBy: [{ transactionDate: "asc" }, { importLine: "asc" }, { createdAt: "asc" }],
    include: { matches: { orderBy: { matchedAt: "asc" }, include: { journalLine: { select: { id: true, debit: true, credit: true, entry: { select: { id: true, number: true, entryDate: true, description: true, kind: true } } } } } } },
  });
  const major = (v: number) => toMajorNumber(v, cur);
  return {
    reconciliation: runDto(run, cur),
    live: live
      ? {
          ledgerOpeningBalance: major(c.ledgerOpeningBalance), ledgerBalance: major(c.ledgerBalance), statementMovement: major(c.statementMovement),
          difference: major(c.difference), unexplainedDifference: major(c.unexplainedDifference), statementGap: major(c.statementGap),
          outstandingLedgerNet: major(c.outstandingLedgerNet), unmatchedStatementNet: major(c.unmatchedStatementNet),
          matchedCount: c.matchedCount, unmatchedCount: c.unmatchedCount, outstandingLedgerCount: c.outstandingLedgerCount, adjustmentCount: c.adjustmentCount,
          earlierUnreconciledLines: earlierUnreconciled,
          canComplete: c.statementGap === 0 && c.unmatchedCount === 0 && c.unexplainedDifference === 0,
        }
      : null,
    statementLines: lines.map(bankTransactionDto),
    outstandingLedgerLines: outstanding.map(({ remainingMinor: _r, ...l }) => l),
  };
}

/** Matches every period statement line that has exactly one candidate: a ledger line of the same direction whose unmatched
 * remainder equals the line's, dated within ±3 days, and not already claimed in this pass. Ambiguous lines are left alone. */
export async function autoMatch(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const run = await lockRun(tx, business.id, id);
    if (run.status !== "IN_PROGRESS") throw financeError(409, "RECONCILIATION_CLOSED", "This reconciliation is no longer in progress");
    const fa = await tx.financialAccount.findUniqueOrThrow({ where: { id: run.financialAccountId } });
    const statement = await tx.bankTransaction.findMany({ where: { financialAccountId: fa.id, reconciliationId: null, transactionDate: { gte: run.periodStart, lte: run.periodEnd } }, orderBy: [{ transactionDate: "asc" }, { importLine: "asc" }] });
    const ledger = await outstandingLines(business.id, fa.ledgerAccountId, cur, { from: null, to: null }, tx);
    const claimed = new Set<string>();
    let matched = 0;
    for (const s of statement) {
      const remaining = Math.abs(toMinor(s.amount, cur)) - toMinor(s.matchedAmount, cur);
      if (remaining <= 0) continue;
      const moneyIn = toMinor(s.amount, cur) > 0;
      const day = s.transactionDate.getTime();
      const candidates = ledger.filter(
        (l) => !claimed.has(l.journalLineId) && (moneyIn ? l.debit > 0 : l.credit > 0) && l.remainingMinor === remaining && Math.abs(Date.parse(l.entryDate) - day) <= 3 * 86_400_000,
      );
      if (candidates.length !== 1) continue;
      claimed.add(candidates[0]!.journalLineId);
      const bt = await tx.bankTransaction.findUniqueOrThrow({ where: { id: s.id }, include: { matches: { include: { journalLine: { select: { id: true, debit: true, credit: true, entry: { select: { id: true, number: true, entryDate: true, description: true, kind: true } } } } } } } });
      await matchInTx(tx, business, bt, { journalLineId: candidates[0]!.journalLineId, amountMinor: remaining, reconciliationId: run.id, note: "auto-match: same amount, ±3 days" }, actor);
      matched += 1;
    }
    return { matched };
  });
}

export async function completeReconciliation(id: string, input: { notes?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const run = await lockRun(tx, business.id, id);
    if (run.status === "COMPLETED") return runDto(run, cur);
    if (run.status !== "IN_PROGRESS") throw financeError(409, "RECONCILIATION_CLOSED", "An abandoned reconciliation can't be completed");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-recon:${run.financialAccountId}`}))`;
    const { c, fa, inPeriod } = await compute(tx, business, run);
    const major = (v: number) => toMajorNumber(v, cur);
    if (c.statementGap !== 0) {
      throw financeError(409, "STATEMENT_INCOMPLETE", `Opening balance + statement lines differ from the closing balance by ${major(c.statementGap)} — a statement line is missing or duplicated`, { statementGap: major(c.statementGap) });
    }
    if (c.unmatchedCount > 0) throw financeError(409, "UNMATCHED_STATEMENT_LINES", `${c.unmatchedCount} statement line(s) of the period are not fully matched — match them or resolve them with an adjustment`, { unmatchedCount: c.unmatchedCount });
    if (c.unexplainedDifference !== 0) {
      throw financeError(409, "UNEXPLAINED_DIFFERENCE", `The books and the statement differ by ${major(c.unexplainedDifference)} that no outstanding item explains`, {
        difference: major(c.difference), unexplainedDifference: major(c.unexplainedDifference), outstandingLedgerNet: major(c.outstandingLedgerNet),
      });
    }
    const audits: FinanceAuditInput[] = [];
    for (const l of inPeriod) {
      await tx.bankTransaction.update({ where: { id: l.id }, data: { reconciliationId: run.id } });
      audits.push({ businessId: business.id, actor, action: "bank_line.reconcile", entityType: "BankTransaction", entityId: l.id, before: { status: l.status }, after: { status: "RECONCILED", reconciliationId: run.id } });
    }
    if (!fa.reconciliationStartDate) {
      const updated = await tx.financialAccount.update({ where: { id: fa.id }, data: { reconciliationStartDate: run.periodStart } });
      audits.push({ businessId: business.id, actor, action: "financial_account.reconciliation_start", entityType: "FinancialAccount", entityId: fa.id, before: { reconciliationStartDate: null }, after: { reconciliationStartDate: businessDateOf(updated.reconciliationStartDate!) } });
    }
    const after = await tx.bankReconciliation.update({
      where: { id },
      data: { ...snapshotData(c, cur), status: "COMPLETED", notes: input.notes ?? null, completedByAdminId: adminId(actor), completedAt: new Date() },
    });
    audits.push({ businessId: business.id, actor, action: "bank_reconciliation.complete", entityType: "BankReconciliation", entityId: id, before: { status: run.status }, after: runDto(after, cur), reason: input.notes ?? null });
    await recordFinanceAudit(tx, audits);
    return runDto(after, cur);
  });
}

export async function abandonReconciliation(id: string, reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const run = await lockRun(tx, business.id, id);
    if (run.status === "ABANDONED") return runDto(run, cur);
    if (run.status !== "IN_PROGRESS") throw financeError(409, "RECONCILIATION_CLOSED", "A completed reconciliation is history and can't be abandoned");
    const { c } = await compute(tx, business, run);
    const after = await tx.bankReconciliation.update({ where: { id }, data: { ...snapshotData(c, cur), status: "ABANDONED", abandonedAt: new Date(), abandonReason: reason } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "bank_reconciliation.abandon", entityType: "BankReconciliation", entityId: id, before: { status: run.status }, after: { status: after.status }, reason });
    return runDto(after, cur);
  });
}

export async function listReconciliations(q: { financialAccountId?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where = { businessId: business.id, financialAccountId: q.financialAccountId };
  const [total, rows] = await Promise.all([
    prisma.bankReconciliation.count({ where }),
    prisma.bankReconciliation.findMany({ where, orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, reconciliations: rows.map((r) => runDto(r, business.baseCurrency)) };
}
