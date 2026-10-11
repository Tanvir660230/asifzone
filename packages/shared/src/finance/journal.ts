/**
 * Pure double-entry rules (Financial Core Phase 1). No Prisma, no clock. Amounts are integer MINOR units of one currency
 * (the `Money` convention, engines/money.ts); conversion to Decimal happens only at the database boundary.
 *
 * The same rules are enforced again by the database (migration triggers): this engine gives callers precise errors before
 * anything is written; the database guarantees nothing unbalanced or edited-after-posting can exist even if a caller
 * bypassed the service.
 */
import type { NormalBalance } from "./accounts";

export interface JournalAmountLine {
  /** Minor units, ≥ 0. Exactly one of debit / credit is positive. */
  debit: number;
  credit: number;
}

export type JournalIssueCode =
  | "TOO_FEW_LINES"
  | "NOT_INTEGER"
  | "NEGATIVE_AMOUNT"
  | "LINE_BOTH_SIDES"
  | "LINE_NO_AMOUNT"
  | "UNBALANCED"
  | "ZERO_TOTAL";

export interface JournalIssue {
  code: JournalIssueCode;
  /** 0-based line index, when the issue belongs to one line. */
  line?: number;
  message: string;
}

export interface JournalCheck {
  ok: boolean;
  issues: JournalIssue[];
  totalDebit: number;
  totalCredit: number;
}

/** Validates the amounts of a journal: ≥ 2 lines, each with exactly one positive side, Σ debit = Σ credit > 0. */
export function checkJournal(lines: readonly JournalAmountLine[]): JournalCheck {
  const issues: JournalIssue[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  if (lines.length < 2) issues.push({ code: "TOO_FEW_LINES", message: "A journal entry needs at least two lines" });
  lines.forEach((l, i) => {
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit)) {
      issues.push({ code: "NOT_INTEGER", line: i, message: `Line ${i + 1}: amounts must be whole minor units` });
      return;
    }
    if (l.debit < 0 || l.credit < 0) issues.push({ code: "NEGATIVE_AMOUNT", line: i, message: `Line ${i + 1}: amounts can't be negative` });
    else if (l.debit > 0 && l.credit > 0) issues.push({ code: "LINE_BOTH_SIDES", line: i, message: `Line ${i + 1}: a line is either a debit or a credit` });
    else if (l.debit === 0 && l.credit === 0) issues.push({ code: "LINE_NO_AMOUNT", line: i, message: `Line ${i + 1}: amount is zero` });
    totalDebit += l.debit;
    totalCredit += l.credit;
  });
  if (!issues.some((i) => i.code === "NOT_INTEGER")) {
    if (totalDebit !== totalCredit) issues.push({ code: "UNBALANCED", message: `Debits (${totalDebit}) and credits (${totalCredit}) differ by ${totalDebit - totalCredit}` });
    else if (totalDebit === 0 && lines.length >= 2) issues.push({ code: "ZERO_TOTAL", message: "A journal entry must move a non-zero amount" });
  }
  return { ok: issues.length === 0, issues, totalDebit, totalCredit };
}

/** The lines of a reversal: every debit becomes a credit and vice versa, same accounts and dimensions. */
export function reverseLines<T extends JournalAmountLine>(lines: readonly T[]): T[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

/** An account balance on its normal side: positive = the account's usual direction (an asset in debit, a liability in
 * credit), negative = the opposite (an overdrawn bank, a debit liability). */
export function signedBalance(debit: number, credit: number, normal: NormalBalance): number {
  return normal === "DEBIT" ? debit - credit : credit - debit;
}

export interface TrialBalanceInput {
  accountId: string;
  debit: number;
  credit: number;
}

export interface TrialBalanceRow {
  accountId: string;
  debit: number;
  credit: number;
  /** Net presented on one side, as a trial balance shows it. */
  netDebit: number;
  netCredit: number;
}

/** Aggregates posted line totals per account into trial-balance rows; `balanced` is the double-entry invariant over the set. */
export function trialBalance(rows: readonly TrialBalanceInput[]): { rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number; balanced: boolean } {
  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const r of rows) {
    const acc = byAccount.get(r.accountId) ?? { debit: 0, credit: 0 };
    acc.debit += r.debit;
    acc.credit += r.credit;
    byAccount.set(r.accountId, acc);
  }
  let totalDebit = 0;
  let totalCredit = 0;
  const out: TrialBalanceRow[] = [];
  for (const [accountId, { debit, credit }] of byAccount) {
    const net = debit - credit;
    const row = { accountId, debit, credit, netDebit: net > 0 ? net : 0, netCredit: net < 0 ? -net : 0 };
    totalDebit += row.netDebit;
    totalCredit += row.netCredit;
    out.push(row);
  }
  return { rows: out, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

/** A stable fingerprint of a journal's content, used to tell a true repeat of an idempotent request from a different
 * request that reused the same key. Order-independent over lines. */
export function journalFingerprint(input: {
  entryDate: string;
  currency: string;
  lines: ReadonlyArray<JournalAmountLine & { accountId: string; brandId?: string | null; memo?: string | null }>;
}): string {
  const lines = input.lines.map((l) => `${l.accountId}|${l.debit}|${l.credit}|${l.brandId ?? ""}`).sort();
  return `${input.entryDate}#${input.currency}#${lines.join(";")}`;
}
