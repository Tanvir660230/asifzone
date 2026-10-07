/**
 * General ledger reads (Phase 1): trial balance and per-account ledger with running balance. POSTED journals only. A line's
 * brand is its own brandId, else its entry's brandId (company-level lines have neither and appear only in the business
 * view). Amounts are summed exactly in SQL (numeric) and converted to minor units once.
 */
import { Prisma } from "@prisma/client";
import { signedBalance, trialBalance as engineTrialBalance } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { getFinanceContext } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toMajorNumber, toMinor, FULL_VIEW, type FinanceViewer } from "./finance-values";

export interface LedgerRange {
  from?: string;
  to?: string;
  brandId?: string;
}

function brandFilter(brandId: string | undefined): Prisma.Sql {
  return brandId ? Prisma.sql`AND COALESCE(l."brandId", e."brandId") = ${brandId}` : Prisma.empty;
}

interface SumRow {
  accountId: string;
  openDebit: Prisma.Decimal;
  openCredit: Prisma.Decimal;
  periodDebit: Prisma.Decimal;
  periodCredit: Prisma.Decimal;
}

/** Per-account sums of posted lines: before `from` (opening) and within [from, to] (period). */
export async function accountSums(businessId: string, range: LedgerRange): Promise<SumRow[]> {
  const from = range.from ? dateColumn(range.from) : null;
  return prisma.$queryRaw<SumRow[]>`
    SELECT l."accountId",
      COALESCE(SUM(CASE WHEN ${from}::date IS NOT NULL AND e."entryDate" < ${from}::date THEN l."debit" ELSE 0 END), 0) AS "openDebit",
      COALESCE(SUM(CASE WHEN ${from}::date IS NOT NULL AND e."entryDate" < ${from}::date THEN l."credit" ELSE 0 END), 0) AS "openCredit",
      COALESCE(SUM(CASE WHEN ${from}::date IS NULL OR e."entryDate" >= ${from}::date THEN l."debit" ELSE 0 END), 0) AS "periodDebit",
      COALESCE(SUM(CASE WHEN ${from}::date IS NULL OR e."entryDate" >= ${from}::date THEN l."credit" ELSE 0 END), 0) AS "periodCredit"
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."businessId" = ${businessId} AND e.status = 'POSTED'
      ${range.to ? Prisma.sql`AND e."entryDate" <= ${dateColumn(range.to)}::date` : Prisma.empty}
      ${brandFilter(range.brandId)}
    GROUP BY l."accountId"`;
}

export async function getTrialBalance(range: LedgerRange, viewer: FinanceViewer = FULL_VIEW) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const [sums, accounts] = await Promise.all([accountSums(business.id, range), prisma.ledgerAccount.findMany({ where: { businessId: business.id } })]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rows = sums
    .map((s) => {
      const a = byId.get(s.accountId)!;
      const od = toMinor(s.openDebit, cur), oc = toMinor(s.openCredit, cur), pd = toMinor(s.periodDebit, cur), pc = toMinor(s.periodCredit, cur);
      const closingNet = od + pd - (oc + pc);
      return {
        accountId: a.id, code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance,
        opening: toMajorNumber(signedBalance(od, oc, a.normalBalance), cur),
        periodDebit: toMajorNumber(pd, cur),
        periodCredit: toMajorNumber(pc, cur),
        closingDebit: toMajorNumber(closingNet > 0 ? closingNet : 0, cur),
        closingCredit: toMajorNumber(closingNet < 0 ? -closingNet : 0, cur),
        balance: toMajorNumber(signedBalance(od + pd, oc + pc, a.normalBalance), cur),
        _minor: { debit: od + pd, credit: oc + pc },
      };
    })
    .sort((x, y) => x.code.localeCompare(y.code));
  const tb = engineTrialBalance(rows.map((r) => ({ accountId: r.accountId, debit: r._minor.debit, credit: r._minor.credit })));
  if (!viewer.sensitive) {
    // Ownership, partner and payroll accounts are folded into one row: the totals still balance, nothing is attributed.
    const hidden = rows.filter((r) => byId.get(r.accountId)!.isSensitive);
    if (hidden.length) {
      const d = hidden.reduce((s, r) => s + r._minor.debit, 0);
      const c = hidden.reduce((s, r) => s + r._minor.credit, 0);
      const net = d - c;
      const restricted = {
        accountId: "restricted", code: "—", name: "Restricted accounts (ownership, partners, payroll)", type: "RESTRICTED" as never, normalBalance: "DEBIT" as const,
        opening: null as never, periodDebit: null as never, periodCredit: null as never,
        closingDebit: toMajorNumber(net > 0 ? net : 0, cur), closingCredit: toMajorNumber(net < 0 ? -net : 0, cur), balance: null as never, _minor: { debit: d, credit: c },
      };
      rows.splice(0, rows.length, ...rows.filter((r) => !byId.get(r.accountId)!.isSensitive), restricted);
    }
  }
  return {
    currency: cur,
    range: { from: range.from ?? null, to: range.to ?? null, brandId: range.brandId ?? null },
    rows: rows.map(({ _minor, ...r }) => r),
    totalDebit: toMajorNumber(tb.totalDebit, cur),
    totalCredit: toMajorNumber(tb.totalCredit, cur),
    balanced: tb.balanced,
  };
}

const LEDGER_LIMIT = 5000;

export async function getAccountLedger(accountId: string, range: LedgerRange, viewer: FinanceViewer = FULL_VIEW) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const account = await prisma.ledgerAccount.findFirst({ where: { id: accountId, businessId: business.id } });
  if (!account) throw financeError(404, "ACCOUNT_NOT_FOUND", "Account not found");
  if (account.isSensitive && !viewer.sensitive) throw financeError(403, "SENSITIVE_ACCOUNT", "This account's ledger is restricted to the owner");
  const from = range.from ? dateColumn(range.from) : null;
  const [opening = { d: new Prisma.Decimal(0), c: new Prisma.Decimal(0) }] = from
    ? await prisma.$queryRaw<Array<{ d: Prisma.Decimal; c: Prisma.Decimal }>>`
        SELECT COALESCE(SUM(l."debit"), 0) AS d, COALESCE(SUM(l."credit"), 0) AS c
        FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
        WHERE e."businessId" = ${business.id} AND e.status = 'POSTED' AND l."accountId" = ${accountId} AND e."entryDate" < ${from}::date ${brandFilter(range.brandId)}`
    : [{ d: new Prisma.Decimal(0), c: new Prisma.Decimal(0) }];
  const lines = await prisma.$queryRaw<Array<{ entryId: string; number: number; entryDate: Date; kind: string; description: string; reference: string | null; lineNo: number; debit: Prisma.Decimal; credit: Prisma.Decimal; memo: string | null; brandId: string | null; valuationStatus: string | null }>>`
    SELECT e.id AS "entryId", e.number, e."entryDate", e.kind, e.description, e.reference, l."lineNo", l.debit, l.credit, l.memo,
           COALESCE(l."brandId", e."brandId") AS "brandId", l."valuationStatus"
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."businessId" = ${business.id} AND e.status = 'POSTED' AND l."accountId" = ${accountId}
      ${from ? Prisma.sql`AND e."entryDate" >= ${from}::date` : Prisma.empty}
      ${range.to ? Prisma.sql`AND e."entryDate" <= ${dateColumn(range.to)}::date` : Prisma.empty}
      ${brandFilter(range.brandId)}
    ORDER BY e."entryDate", e.number, l."lineNo"
    LIMIT ${LEDGER_LIMIT + 1}`;
  let running = signedBalance(toMinor(opening.d, cur), toMinor(opening.c, cur), account.normalBalance);
  const openingBalance = running;
  const truncated = lines.length > LEDGER_LIMIT;
  const out = lines.slice(0, LEDGER_LIMIT).map((l) => {
    const d = toMinor(l.debit, cur), c = toMinor(l.credit, cur);
    running += signedBalance(d, c, account.normalBalance);
    return { ...l, entryDate: businessDateOf(l.entryDate), debit: toMajorNumber(d, cur), credit: toMajorNumber(c, cur), balance: toMajorNumber(running, cur) };
  });
  return {
    currency: cur,
    account: { id: account.id, code: account.code, name: account.name, type: account.type, normalBalance: account.normalBalance },
    range: { from: range.from ?? null, to: range.to ?? null, brandId: range.brandId ?? null },
    openingBalance: toMajorNumber(openingBalance, cur),
    closingBalance: toMajorNumber(running, cur),
    lines: out,
    truncated,
  };
}

/** Signed (normal-side) balance in minor units of the accounts behind the given ids over a date range. */
export async function balanceOfAccounts(businessId: string, accountIds: string[], range: LedgerRange): Promise<Map<string, { debit: number; credit: number }>> {
  const cur = (await prisma.financeBusiness.findUniqueOrThrow({ where: { id: businessId }, select: { baseCurrency: true } })).baseCurrency;
  const sums = await accountSums(businessId, range);
  const out = new Map<string, { debit: number; credit: number }>();
  for (const s of sums) if (accountIds.includes(s.accountId)) out.set(s.accountId, { debit: toMinor(s.periodDebit, cur), credit: toMinor(s.periodCredit, cur) });
  return out;
}

/** Balance (debit − credit, minor units) of a ledger account over POSTED lines dated on or before `date` (null = all). */
export async function moneyBalanceAt(db: AppTransactionClient | typeof prisma, businessId: string, ledgerAccountId: string, currency: string, date: string | null): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ d: Prisma.Decimal; c: Prisma.Decimal }>>`
    SELECT COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."businessId" = ${businessId} AND e.status = 'POSTED' AND l."accountId" = ${ledgerAccountId}
      AND (${date ? dateColumn(date) : null}::date IS NULL OR e."entryDate" <= ${date ? dateColumn(date) : null}::date)`;
  return toMinor(row?.d ?? 0, currency) - toMinor(row?.c ?? 0, currency);
}
