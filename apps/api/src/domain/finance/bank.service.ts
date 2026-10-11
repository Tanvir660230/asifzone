/**
 * Statement lines, matching and statement import (Financial Core Phase 2, docs/FINANCE_PHASE_2.md §4–§6).
 *
 * A statement line (BankTransaction) is what the bank / wallet / gateway says happened. It never posts: it is MATCHED to
 * ledger lines of the same money account (partially, if amounts differ). The matched amount and the status are derived by
 * the database from the ACTIVE matches; unmatching marks a match REMOVED (history is kept). When a line has no internal
 * counterpart, the difference is resolved EXPLICITLY — an ADJUSTMENT movement posted through journal.service and matched
 * to the line — never by changing a balance.
 */
import { createHash } from "node:crypto";
import type { BankTransaction, BankTransactionStatus, Prisma } from "@prisma/client";
import type { StatementImportInput } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "./finance-audit";
import { getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { parseStatement } from "./statement-parser";
import { movementDto, requestMovementInTx } from "./treasury.service";

const adminId = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

const BT_INCLUDE = {
  matches: {
    orderBy: { matchedAt: "asc" },
    include: { journalLine: { select: { id: true, debit: true, credit: true, entry: { select: { id: true, number: true, entryDate: true, description: true, kind: true } } } } },
  },
} satisfies Prisma.BankTransactionInclude;
type BtRow = Prisma.BankTransactionGetPayload<{ include: typeof BT_INCLUDE }>;

export function bankTransactionDto(b: BtRow) {
  const cur = b.currency;
  const major = (v: Prisma.Decimal) => toMajorNumber(toMinor(v, cur), cur);
  return {
    id: b.id,
    financialAccountId: b.financialAccountId,
    transactionDate: businessDateOf(b.transactionDate),
    valueDate: b.valueDate ? businessDateOf(b.valueDate) : null,
    reference: b.reference,
    description: b.description,
    debit: major(b.debit),
    credit: major(b.credit),
    amount: major(b.amount),
    currency: cur,
    externalId: b.externalId,
    statementBalance: b.statementBalance === null ? null : major(b.statementBalance),
    source: b.source,
    importId: b.importId,
    importLine: b.importLine,
    status: b.status,
    matchedAmount: major(b.matchedAmount),
    unmatchedAmount: toMajorNumber(Math.abs(toMinor(b.amount, cur)) - toMinor(b.matchedAmount, cur), cur),
    adjustmentRequired: b.adjustmentRequired,
    note: b.note,
    reconciliationId: b.reconciliationId,
    createdAt: b.createdAt,
    matches: b.matches.map((m) => ({
      id: m.id,
      status: m.status,
      amount: major(m.amount),
      journalLineId: m.journalLineId,
      journalEntry: { id: m.journalLine.entry.id, number: m.journalLine.entry.number, entryDate: businessDateOf(m.journalLine.entry.entryDate), description: m.journalLine.entry.description, kind: m.journalLine.entry.kind },
      matchedAt: m.matchedAt,
      matchedByAdminId: m.matchedByAdminId,
      reconciliationId: m.reconciliationId,
      reference: m.reference,
      note: m.note,
      adjustmentMovementId: m.adjustmentMovementId,
      removedAt: m.removedAt,
      removedByAdminId: m.removedByAdminId,
      removalReason: m.removalReason,
    })),
  };
}
export type BankTransactionDto = ReturnType<typeof bankTransactionDto>;

async function moneyAccount(db: AppTransactionClient | typeof prisma, business: FinanceBusinessInfo, id: string) {
  const fa = await db.financialAccount.findFirst({ where: { id, businessId: business.id } });
  if (!fa) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "Financial account not found");
  return fa;
}

async function lockBankTransaction(tx: AppTransactionClient, businessId: string, id: string): Promise<BtRow> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "BankTransaction" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "BANK_TRANSACTION_NOT_FOUND", "Statement line not found");
  return tx.bankTransaction.findUniqueOrThrow({ where: { id }, include: BT_INCLUDE });
}

const reload = (tx: AppTransactionClient, id: string) => tx.bankTransaction.findUniqueOrThrow({ where: { id }, include: BT_INCLUDE });

// ── manual statement lines ──────────────────────────────────────────────────────────────────────────────────────────

export interface BankTransactionInput {
  financialAccountId: string;
  transactionDate: string;
  valueDate?: string | null;
  reference?: string | null;
  description: string;
  debit: number;
  credit: number;
  externalId?: string | null;
  statementBalance?: number | null;
}

/** Enters a statement line by hand. Idempotent by its external id, else by the Idempotency-Key (one of them is required). */
export async function createBankTransaction(input: BankTransactionInput, actor: FinanceActor, idempotencyKey: string | null) {
  if (!input.externalId && !idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header (or the bank's transaction id)");
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const fa = await moneyAccount(tx, business, input.financialAccountId);
    if (!fa.isActive) throw financeError(409, "FINANCIAL_ACCOUNT_INACTIVE", `${fa.name} is inactive`);
    const dedupeKey = input.externalId ? `ext:${input.externalId}` : `manual:${idempotencyKey}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-bank-line:${fa.id}:${dedupeKey}`}))`;
    const debit = toMinor(input.debit, cur);
    const credit = toMinor(input.credit, cur);
    const existing = await tx.bankTransaction.findUnique({ where: { financialAccountId_dedupeKey: { financialAccountId: fa.id, dedupeKey } }, include: BT_INCLUDE });
    if (existing) {
      const same = businessDateOf(existing.transactionDate) === input.transactionDate && toMinor(existing.debit, cur) === debit && toMinor(existing.credit, cur) === credit;
      if (!same) throw financeError(409, "DUPLICATE_STATEMENT_LINE", "A different statement line already uses this transaction id / key", { bankTransactionId: existing.id });
      return { bankTransaction: bankTransactionDto(existing), replayed: true };
    }
    const created = await tx.bankTransaction.create({
      data: {
        businessId: business.id,
        financialAccountId: fa.id,
        transactionDate: dateColumn(input.transactionDate),
        valueDate: input.valueDate ? dateColumn(input.valueDate) : null,
        reference: input.reference ?? null,
        description: input.description,
        debit: toDecimal(debit, cur),
        credit: toDecimal(credit, cur),
        amount: toDecimal(credit - debit, cur),
        currency: cur,
        externalId: input.externalId ?? null,
        statementBalance: input.statementBalance == null ? null : toDecimal(toMinor(Math.abs(input.statementBalance), cur) * Math.sign(input.statementBalance), cur),
        source: "MANUAL",
        dedupeKey,
        createdByAdminId: adminId(actor),
      },
      include: BT_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "bank_line.create", entityType: "BankTransaction", entityId: created.id, after: bankTransactionDto(created), sourceType: "MANUAL", sourceRef: dedupeKey });
    return { bankTransaction: bankTransactionDto(created), replayed: false };
  });
}

/** Only an untouched, hand-entered line can be removed (a typo); anything matched, imported or reconciled is history. */
export async function deleteBankTransaction(id: string, reason: string | null, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const bt = await lockBankTransaction(tx, business.id, id);
    if (bt.source !== "MANUAL" || bt.matches.length || bt.reconciliationId) throw financeError(409, "BANK_LINE_HAS_HISTORY", "Only an unmatched, hand-entered statement line can be deleted");
    await tx.bankTransaction.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "bank_line.delete", entityType: "BankTransaction", entityId: id, before: bankTransactionDto(bt), reason });
  });
}

export async function getBankTransaction(id: string) {
  const { business } = await getFinanceContext();
  const bt = await prisma.bankTransaction.findFirst({ where: { id, businessId: business.id }, include: BT_INCLUDE });
  if (!bt) throw financeError(404, "BANK_TRANSACTION_NOT_FOUND", "Statement line not found");
  return bankTransactionDto(bt);
}

export async function listBankTransactions(q: { financialAccountId?: string; status?: BankTransactionStatus; from?: string; to?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where: Prisma.BankTransactionWhereInput = {
    businessId: business.id,
    financialAccountId: q.financialAccountId,
    status: q.status,
    transactionDate: q.from || q.to ? { gte: q.from ? dateColumn(q.from) : undefined, lte: q.to ? dateColumn(q.to) : undefined } : undefined,
  };
  const [total, rows] = await Promise.all([
    prisma.bankTransaction.count({ where }),
    prisma.bankTransaction.findMany({ where, include: BT_INCLUDE, orderBy: [{ transactionDate: "desc" }, { importLine: "desc" }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, bankTransactions: rows.map(bankTransactionDto) };
}

// ── matching ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Unmatched remainder of a ledger line (minor units), from its ACTIVE matches. */
async function lineRemainder(tx: AppTransactionClient | typeof prisma, journalLineId: string, currency: string) {
  const line = await tx.journalLine.findUnique({ where: { id: journalLineId }, include: { entry: { select: { businessId: true, status: true } } } });
  if (!line) return null;
  const agg = await tx.bankTransactionMatch.aggregate({ where: { journalLineId, status: "ACTIVE" }, _sum: { amount: true } });
  const total = toMinor(line.debit, currency) + toMinor(line.credit, currency);
  return { line, total, remaining: total - toMinor(agg._sum.amount, currency) };
}

async function assertRunOpen(tx: AppTransactionClient, businessId: string, reconciliationId: string | null | undefined, financialAccountId: string) {
  if (!reconciliationId) return;
  const run = await tx.bankReconciliation.findFirst({ where: { id: reconciliationId, businessId } });
  if (!run || run.financialAccountId !== financialAccountId) throw financeError(400, "RECONCILIATION_NOT_FOUND", "That reconciliation isn't for this account");
  if (run.status !== "IN_PROGRESS") throw financeError(409, "RECONCILIATION_CLOSED", "That reconciliation is no longer in progress");
}

export async function matchInTx(
  tx: AppTransactionClient,
  business: FinanceBusinessInfo,
  bt: BtRow,
  input: { journalLineId: string; amountMinor?: number; reconciliationId?: string | null; reference?: string | null; note?: string | null; adjustmentMovementId?: string | null },
  actor: FinanceActor,
) {
  const cur = business.baseCurrency;
  if (bt.reconciliationId) throw financeError(409, "BANK_LINE_RECONCILED", "This statement line is reconciled; its matches are final");
  await assertRunOpen(tx, business.id, input.reconciliationId, bt.financialAccountId);
  const fa = await tx.financialAccount.findUniqueOrThrow({ where: { id: bt.financialAccountId } });
  const r = await lineRemainder(tx, input.journalLineId, cur);
  if (!r || r.line.entry.businessId !== business.id) throw financeError(404, "JOURNAL_LINE_NOT_FOUND", "Ledger line not found");
  if (r.line.accountId !== fa.ledgerAccountId) throw financeError(400, "MATCH_WRONG_ACCOUNT", `That ledger line isn't on ${fa.name}`);
  if (r.line.entry.status !== "POSTED") throw financeError(400, "MATCH_NOT_POSTED", "Only posted ledger lines can be matched");
  const moneyIn = toMinor(bt.amount, cur) > 0;
  if (moneyIn !== toMinor(r.line.debit, cur) > 0) throw financeError(400, "MATCH_DIRECTION", "Money in on the statement matches money in in the books (a debit), and money out a credit");
  if (bt.matches.some((m) => m.status === "ACTIVE" && m.journalLineId === input.journalLineId)) {
    throw financeError(409, "ALREADY_MATCHED", "This statement line is already matched to that ledger line");
  }
  const btRemaining = Math.abs(toMinor(bt.amount, cur)) - toMinor(bt.matchedAmount, cur);
  const amount = input.amountMinor ?? Math.min(btRemaining, r.remaining);
  if (amount <= 0) throw financeError(409, "NOTHING_TO_MATCH", "Nothing is left to match on one of the two sides");
  if (amount > btRemaining) throw financeError(400, "MATCH_EXCEEDS_STATEMENT_LINE", `Only ${toMajorNumber(btRemaining, cur)} of the statement line is unmatched`);
  if (amount > r.remaining) throw financeError(400, "MATCH_EXCEEDS_LEDGER_LINE", `Only ${toMajorNumber(r.remaining, cur)} of the ledger line is unmatched`);
  const match = await tx.bankTransactionMatch.create({
    data: {
      businessId: business.id,
      bankTransactionId: bt.id,
      journalLineId: input.journalLineId,
      amount: toDecimal(amount, cur),
      matchedByAdminId: adminId(actor),
      reconciliationId: input.reconciliationId ?? null,
      reference: input.reference ?? null,
      note: input.note ?? null,
      adjustmentMovementId: input.adjustmentMovementId ?? null,
    },
  });
  const after = await reload(tx, bt.id);
  await recordFinanceAudit(tx, [
    { businessId: business.id, actor, action: "bank_match.create", entityType: "BankTransactionMatch", entityId: match.id, after: match, sourceType: "BankTransaction", sourceRef: bt.id },
    { businessId: business.id, actor, action: "bank_line.match", entityType: "BankTransaction", entityId: bt.id, before: { status: bt.status, matchedAmount: bt.matchedAmount }, after: { status: after.status, matchedAmount: after.matchedAmount }, sourceRef: match.id },
  ]);
  return after;
}

export async function matchBankTransaction(id: string, input: { journalLineId: string; amount?: number; reconciliationId?: string | null; reference?: string | null; note?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const bt = await lockBankTransaction(tx, business.id, id);
    const after = await matchInTx(tx, business, bt, { ...input, amountMinor: input.amount === undefined ? undefined : toMinor(input.amount, business.baseCurrency) }, actor);
    return bankTransactionDto(after);
  });
}

export async function unmatch(matchId: string, reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const match = await tx.bankTransactionMatch.findFirst({ where: { id: matchId, businessId: business.id } });
    if (!match) throw financeError(404, "MATCH_NOT_FOUND", "Match not found");
    const bt = await lockBankTransaction(tx, business.id, match.bankTransactionId);
    if (match.status === "REMOVED") return bankTransactionDto(bt);
    if (bt.reconciliationId) throw financeError(409, "BANK_LINE_RECONCILED", "This statement line is reconciled; its matches are final");
    const removed = await tx.bankTransactionMatch.update({ where: { id: matchId }, data: { status: "REMOVED", removedAt: new Date(), removedByAdminId: adminId(actor), removalReason: reason } });
    const after = await reload(tx, bt.id);
    await recordFinanceAudit(tx, [
      { businessId: business.id, actor, action: "bank_match.remove", entityType: "BankTransactionMatch", entityId: matchId, before: match, after: removed, reason },
      { businessId: business.id, actor, action: "bank_line.unmatch", entityType: "BankTransaction", entityId: bt.id, before: { status: bt.status, matchedAmount: bt.matchedAmount }, after: { status: after.status, matchedAmount: after.matchedAmount }, reason, sourceRef: matchId },
    ]);
    return bankTransactionDto(after);
  });
}

export async function flagBankTransaction(id: string, input: { adjustmentRequired: boolean; note?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const bt = await lockBankTransaction(tx, business.id, id);
    if (bt.reconciliationId) throw financeError(409, "BANK_LINE_RECONCILED", "This statement line is reconciled and final");
    await tx.bankTransaction.update({ where: { id }, data: { adjustmentRequired: input.adjustmentRequired, note: input.note === undefined ? bt.note : input.note } });
    const after = await reload(tx, id);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: input.adjustmentRequired ? "bank_line.flag_adjustment" : "bank_line.clear_flag", entityType: "BankTransaction", entityId: id, before: { status: bt.status, note: bt.note }, after: { status: after.status, note: after.note } });
    return bankTransactionDto(after);
  });
}

/** Ledger lines that could explain a statement line: same account, same direction, still (partly) unmatched; the exact
 * amount and the nearest date first. */
export async function matchCandidates(id: string) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const bt = await prisma.bankTransaction.findFirst({ where: { id, businessId: business.id }, include: { financialAccount: true } });
  if (!bt) throw financeError(404, "BANK_TRANSACTION_NOT_FOUND", "Statement line not found");
  const remaining = Math.abs(toMinor(bt.amount, cur)) - toMinor(bt.matchedAmount, cur);
  const moneyIn = toMinor(bt.amount, cur) > 0;
  const rows = await outstandingLines(business.id, bt.financialAccount.ledgerAccountId, cur, { to: null, from: null });
  return rows
    .filter((l) => (moneyIn ? l.debit > 0 : l.credit > 0) && l.remainingMinor > 0)
    .map((l) => ({ ...l, exactAmount: l.remainingMinor === remaining, dayDistance: Math.abs(Date.parse(l.entryDate) - bt.transactionDate.getTime()) / 86_400_000 }))
    .sort((a, b) => Number(b.exactAmount) - Number(a.exactAmount) || a.dayDistance - b.dayDistance)
    .slice(0, 25)
    .map(({ remainingMinor: _r, ...l }) => l);
}

export interface OutstandingLine {
  journalLineId: string;
  entryId: string;
  number: number | null;
  entryDate: string;
  kind: string;
  description: string;
  memo: string | null;
  debit: number;
  credit: number;
  /** Signed (money in +) unmatched remainder, major units. */
  remaining: number;
  remainingMinor: number;
}

/** POSTED ledger lines of a money account with an unmatched remainder (matches to statement lines dated ≤ `matchedBy`
 * count), entry date in [from, to]. */
export async function outstandingLines(businessId: string, ledgerAccountId: string, currency: string, range: { from: string | null; to: string | null; matchedBy?: string | null }, db: AppTransactionClient | typeof prisma = prisma): Promise<OutstandingLine[]> {
  const matchedBy = range.matchedBy ? dateColumn(range.matchedBy) : null;
  const rows = await db.$queryRaw<Array<{ id: string; entryId: string; number: number | null; entryDate: Date; kind: string; description: string; memo: string | null; debit: Prisma.Decimal; credit: Prisma.Decimal; matched: Prisma.Decimal }>>`
    SELECT l.id, e.id AS "entryId", e.number, e."entryDate", e.kind::text AS kind, e.description, l.memo, l.debit, l.credit,
      COALESCE((SELECT SUM(m.amount) FROM "BankTransactionMatch" m JOIN "BankTransaction" b ON b.id = m."bankTransactionId"
                WHERE m."journalLineId" = l.id AND m.status = 'ACTIVE' AND (${matchedBy}::date IS NULL OR b."transactionDate" <= ${matchedBy}::date)), 0) AS matched
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."businessId" = ${businessId} AND e.status = 'POSTED' AND l."accountId" = ${ledgerAccountId}
      AND (${range.from ? dateColumn(range.from) : null}::date IS NULL OR e."entryDate" >= ${range.from ? dateColumn(range.from) : null}::date)
      AND (${range.to ? dateColumn(range.to) : null}::date IS NULL OR e."entryDate" <= ${range.to ? dateColumn(range.to) : null}::date)
    ORDER BY e."entryDate", e.number, l."lineNo"`;
  return rows
    .map((r) => {
      const d = toMinor(r.debit, currency);
      const c = toMinor(r.credit, currency);
      const remainingMinor = d + c - toMinor(r.matched, currency);
      return {
        journalLineId: r.id, entryId: r.entryId, number: r.number, entryDate: businessDateOf(r.entryDate), kind: r.kind, description: r.description, memo: r.memo,
        debit: toMajorNumber(d, currency), credit: toMajorNumber(c, currency),
        remaining: toMajorNumber(d > 0 ? remainingMinor : -remainingMinor, currency), remainingMinor,
      };
    })
    .filter((r) => r.remainingMinor > 0);
}

// ── explicit adjustment (reconciliation difference) ─────────────────────────────────────────────────────────────────

/**
 * Resolves a statement line's unmatched remainder with an explicit ADJUSTMENT movement (bank charge, interest, a missed
 * fee …) against the chosen counter account, posted through journal.service, then matched to the line. Idempotent per line
 * and remainder. If the movement needs approval it stays pending and is matched once approved (by hand).
 */
export async function adjustBankTransaction(id: string, input: { counterAccountId: string; reason: string; description?: string; reconciliationId?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const bt = await lockBankTransaction(tx, business.id, id);
    if (bt.reconciliationId) throw financeError(409, "BANK_LINE_RECONCILED", "This statement line is reconciled and final");
    await assertRunOpen(tx, business.id, input.reconciliationId, bt.financialAccountId);
    const remaining = Math.abs(toMinor(bt.amount, cur)) - toMinor(bt.matchedAmount, cur);
    if (remaining <= 0) throw financeError(409, "NOTHING_TO_ADJUST", "This statement line is fully matched");
    const moneyIn = toMinor(bt.amount, cur) > 0;
    const { movement } = await requestMovementInTx(tx, business, {
      kind: "ADJUSTMENT",
      direction: moneyIn ? "IN" : "OUT",
      movementDate: businessDateOf(bt.transactionDate),
      amount: toMajorNumber(remaining, cur),
      reference: bt.reference ?? bt.externalId,
      description: input.description ?? `Statement: ${bt.description}`.slice(0, 300),
      reason: input.reason,
      ...(moneyIn ? { toFinancialAccountId: bt.financialAccountId } : { fromFinancialAccountId: bt.financialAccountId }),
      counterAccountId: input.counterAccountId,
      bankTransactionId: bt.id,
      reconciliationId: input.reconciliationId ?? null,
    }, actor, `bank-adjust:${bt.id}:${toMinor(bt.matchedAmount, cur)}`);
    if (movement.status !== "POSTED") return { movement: movementDto(movement), bankTransaction: bankTransactionDto(bt) };
    const fa = await tx.financialAccount.findUniqueOrThrow({ where: { id: bt.financialAccountId } });
    const line = await tx.journalLine.findFirstOrThrow({ where: { entryId: movement.journalEntryId!, accountId: fa.ledgerAccountId } });
    const existing = bt.matches.find((m) => m.status === "ACTIVE" && m.adjustmentMovementId === movement.id);
    const after = existing ? bt : await matchInTx(tx, business, bt, { journalLineId: line.id, amountMinor: remaining, reconciliationId: input.reconciliationId, note: input.reason, adjustmentMovementId: movement.id }, actor);
    return { movement: movementDto(movement), bankTransaction: bankTransactionDto(after) };
  });
}

// ── statement import ────────────────────────────────────────────────────────────────────────────────────────────────

function importDto(i: { id: string; financialAccountId: string; fileName: string | null; fileHash: string; columnMapping: unknown; options: unknown; rowCount: number; importedCount: number; duplicateCount: number; errorCount: number; errors: unknown; importedByAdminId: string | null; createdAt: Date }) {
  return { ...i };
}

/** Parses a statement and reports what an import would do, without writing anything. */
export async function previewStatementImport(input: StatementImportInput) {
  const { business } = await getFinanceContext();
  const fa = await moneyAccount(prisma, business, input.financialAccountId);
  const parsed = parseStatement(input.csv, input.mapping, input.options, business.baseCurrency);
  const existing = new Set(
    (await prisma.bankTransaction.findMany({ where: { financialAccountId: fa.id, dedupeKey: { in: parsed.rows.map((r) => r.dedupeKey) } }, select: { dedupeKey: true } })).map((r) => r.dedupeKey),
  );
  const cur = business.baseCurrency;
  return {
    header: parsed.header,
    rowCount: parsed.rows.length + parsed.errors.length,
    newRows: parsed.rows.filter((r) => !existing.has(r.dedupeKey)).length,
    duplicateRows: parsed.rows.filter((r) => existing.has(r.dedupeKey)).length,
    errors: parsed.errors,
    rows: parsed.rows.slice(0, 50).map((r) => ({ ...r, debit: toMajorNumber(r.debit, cur), credit: toMajorNumber(r.credit, cur), balance: r.balance === null ? null : toMajorNumber(r.balance, cur), duplicate: existing.has(r.dedupeKey) })),
  };
}

/**
 * Imports a statement CSV. Idempotent twice over: the same file (sha256) returns the import it already made, and every row
 * whose dedupe key the account already has is skipped — so overlapping exports never duplicate a line. Rows that don't
 * parse are reported, not imported.
 */
export async function importStatement(input: StatementImportInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const fileHash = createHash("sha256").update(input.csv).digest("hex");
  return financeTransaction(async (tx) => {
    const fa = await moneyAccount(tx, business, input.financialAccountId);
    if (!fa.isActive) throw financeError(409, "FINANCIAL_ACCOUNT_INACTIVE", `${fa.name} is inactive`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-import:${fa.id}`}))`;
    const again = await tx.statementImport.findUnique({ where: { financialAccountId_fileHash: { financialAccountId: fa.id, fileHash } } });
    if (again) return { import: importDto(again), replayed: true };

    const parsed = parseStatement(input.csv, input.mapping, input.options, cur);
    const existing = new Set(
      (await tx.bankTransaction.findMany({ where: { financialAccountId: fa.id, dedupeKey: { in: parsed.rows.map((r) => r.dedupeKey) } }, select: { dedupeKey: true } })).map((r) => r.dedupeKey),
    );
    const seen = new Set<string>();
    const fresh = parsed.rows.filter((r) => {
      if (existing.has(r.dedupeKey) || seen.has(r.dedupeKey)) return false;
      seen.add(r.dedupeKey);
      return true;
    });
    const record = await tx.statementImport.create({
      data: {
        businessId: business.id,
        financialAccountId: fa.id,
        fileName: input.fileName ?? null,
        fileHash,
        columnMapping: input.mapping as Prisma.InputJsonValue,
        options: input.options as Prisma.InputJsonValue,
        rowCount: parsed.rows.length + parsed.errors.length,
        importedCount: fresh.length,
        duplicateCount: parsed.rows.length - fresh.length,
        errorCount: parsed.errors.length,
        errors: parsed.errors.slice(0, 500) as unknown as Prisma.InputJsonValue,
        importedByAdminId: adminId(actor),
      },
    });
    const created: BankTransaction[] = fresh.length
      ? await tx.bankTransaction.createManyAndReturn({
          data: fresh.map((r) => ({
            businessId: business.id,
            financialAccountId: fa.id,
            transactionDate: dateColumn(r.transactionDate),
            valueDate: r.valueDate ? dateColumn(r.valueDate) : null,
            reference: r.reference,
            description: r.description,
            debit: toDecimal(r.debit, cur),
            credit: toDecimal(r.credit, cur),
            amount: toDecimal(r.credit - r.debit, cur),
            currency: cur,
            externalId: r.externalId,
            statementBalance: r.balance === null ? null : toDecimal(r.balance, cur),
            source: "CSV_IMPORT" as const,
            importId: record.id,
            importLine: r.line,
            dedupeKey: r.dedupeKey,
            createdByAdminId: adminId(actor),
          })),
        })
      : [];
    const audits: FinanceAuditInput[] = [
      { businessId: business.id, actor, action: "statement.import", entityType: "StatementImport", entityId: record.id, after: { fileName: record.fileName, fileHash, rowCount: record.rowCount, importedCount: record.importedCount, duplicateCount: record.duplicateCount, errorCount: record.errorCount } },
      ...created.map((b) => ({ businessId: business.id, actor, action: "bank_line.import", entityType: "BankTransaction", entityId: b.id, after: { dedupeKey: b.dedupeKey, line: b.importLine, amount: b.amount }, sourceType: "StatementImport", sourceRef: record.id })),
    ];
    await recordFinanceAudit(tx, audits);
    return { import: importDto(record), replayed: false };
  }, { timeout: 60_000 });
}

export async function listStatementImports(q: { financialAccountId?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where = { businessId: business.id, financialAccountId: q.financialAccountId };
  const [total, rows] = await Promise.all([
    prisma.statementImport.count({ where }),
    prisma.statementImport.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, imports: rows.map(importDto) };
}
