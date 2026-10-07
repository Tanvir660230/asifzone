/**
 * The financial reconciliation framework (Phase 1, docs/FINANCE_PHASE_1.md §9). A check compares one ledger figure with
 * the authoritative figure that already exists for it — Finance never defines a second revenue or COGS (F0-2): the
 * dashboard's numbers come from the metrics service, the same call the dashboard makes. Every run of every check is kept
 * as a ReconciliationRun (with its FinanceAuditEntry), and a difference is never rounded away: the comparison is exact in
 * minor units.
 *
 * The ledger side of the commerce checks is this installation's BRAND (lines whose brand — the line's, else the entry's —
 * is this installation's FinanceBrand), because the dashboard is this installation's numbers; the business view sums
 * every brand.
 */
import type { Prisma, ReconciliationRun, ReconciliationStatus } from "@prisma/client";
import { Prisma as P } from "@prisma/client";
import { RECONCILED_COGS_KEY, RECONCILED_REVENUE_KEYS, compareBusinessDates, fromMajor, type AccountMappingKey } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { computeMetrics } from "../metrics/metrics.service";
import { getCommerceSettings } from "../config/commerce-settings";
import { logger } from "../../lib/observability/logger";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { FINANCE_BUSINESS_KEY, businessToday, getFinanceContext, type FinanceContext } from "./finance-context";
import { postingRuleKeys } from "./events.service";
import { dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";

export interface ReconciliationRange {
  from?: string;
  to?: string;
}

interface CheckResult {
  status: ReconciliationStatus;
  /** Minor units; the authoritative figure. */
  expected?: number | null;
  /** Minor units; the ledger figure. */
  actual?: number | null;
  details: Record<string, unknown>;
  range?: { from: string; to: string } | null;
}

interface ReconciliationCheck {
  label: string;
  description: string;
  run(ctx: FinanceContext, range: ReconciliationRange): Promise<CheckResult>;
}

/** [from, to] clamped to the books: nothing before the opening date, nothing after today. Null when the books haven't started. */
function booksRange(ctx: FinanceContext, range: ReconciliationRange): { from: string; to: string } | null {
  const opening = ctx.business.openingDate;
  if (!opening) return null;
  const today = businessToday(ctx.business);
  const from = range.from && compareBusinessDates(range.from, opening) > 0 ? range.from : opening;
  const to = range.to && compareBusinessDates(range.to, today) < 0 ? range.to : today;
  return compareBusinessDates(from, to) <= 0 ? { from, to } : null;
}

/** Σ debit / Σ credit of POSTED lines on the accounts behind `keys`, for one brand, over [from, to]. */
async function mappedSums(ctx: FinanceContext, keys: AccountMappingKey[], range: { from: string; to: string }) {
  const rows = await prisma.$queryRaw<Array<{ key: string; debit: Prisma.Decimal; credit: Prisma.Decimal; valued: bigint; estimated: bigint; missing: bigint }>>`
    SELECT m.key,
           COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit,
           COUNT(*) FILTER (WHERE l."valuationStatus" IN ('KNOWN', 'OPENING_BALANCE')) AS valued,
           COUNT(*) FILTER (WHERE l."valuationStatus" = 'ESTIMATED') AS estimated,
           COUNT(*) FILTER (WHERE l."valuationStatus" = 'MISSING') AS missing
    FROM "AccountMapping" m
    LEFT JOIN "JournalLine" l ON l."accountId" = m."accountId"
      AND EXISTS (SELECT 1 FROM "JournalEntry" e WHERE e.id = l."entryId" AND e.status = 'POSTED'
                  AND e."entryDate" BETWEEN ${dateColumn(range.from)}::date AND ${dateColumn(range.to)}::date
                  AND COALESCE(l."brandId", e."brandId") = ${ctx.brand.id})
    WHERE m."businessId" = ${ctx.business.id} AND m.key IN (${P.join(keys)})
    GROUP BY m.key`;
  const cur = ctx.business.baseCurrency;
  const out = new Map<string, { debit: number; credit: number; valued: number; estimated: number; missing: number }>();
  for (const r of rows) out.set(r.key, { debit: toMinor(r.debit, cur), credit: toMinor(r.credit, cur), valued: Number(r.valued), estimated: Number(r.estimated), missing: Number(r.missing) });
  for (const k of keys) if (!out.has(k)) throw financeError(409, "MAPPING_MISSING", `No account is mapped to ${k}`, { key: k });
  return out;
}

async function dashboardMetric(key: "realised_net_sales" | "cogs", range: { from: string; to: string }, currency: string) {
  const result = await computeMetrics({ metrics: [key], range, fresh: true });
  const metric = result.metrics[key]!;
  if (result.currency !== currency) throw financeError(409, "CURRENCY_MISMATCH", `The dashboard reports in ${result.currency}, the books in ${currency}`);
  return { minor: fromMajor(String(metric.value), currency).amount, coverage: metric.coverage ?? null, estimated: metric.estimated ?? false };
}

const commercePostingRules = () => postingRuleKeys().filter((k) => k.startsWith("order.") || k.startsWith("return.") || k.startsWith("refund."));

const compare = (expected: number, actual: number): ReconciliationStatus => (expected === actual ? "MATCHED" : "DIFFERENCE");

export const RECONCILIATION_CHECKS = {
  "ledger.integrity": {
    label: "Ledger integrity",
    description: "Every posted journal balances, and the trial balance of all posted journals balances.",
    async run(ctx) {
      const unbalanced = await prisma.$queryRaw<Array<{ id: string; number: number | null; debit: Prisma.Decimal; credit: Prisma.Decimal }>>`
        SELECT e.id, e.number, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
        FROM "JournalEntry" e LEFT JOIN "JournalLine" l ON l."entryId" = e.id
        WHERE e."businessId" = ${ctx.business.id} AND e.status = 'POSTED'
        GROUP BY e.id HAVING COALESCE(SUM(l.debit), 0) <> COALESCE(SUM(l.credit), 0) OR COUNT(l.id) < 2 LIMIT 50`;
      const [totals] = await prisma.$queryRaw<Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal; entries: bigint }>>`
        SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit, COUNT(DISTINCT e.id) AS entries
        FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
        WHERE e."businessId" = ${ctx.business.id} AND e.status = 'POSTED'`;
      const cur = ctx.business.baseCurrency;
      const debit = toMinor(totals?.debit ?? 0, cur);
      const credit = toMinor(totals?.credit ?? 0, cur);
      return {
        status: unbalanced.length === 0 && debit === credit ? "MATCHED" : "DIFFERENCE",
        expected: debit,
        actual: credit,
        details: { postedEntries: Number(totals?.entries ?? 0), unbalancedEntries: unbalanced.map((u) => ({ id: u.id, number: u.number })) },
      };
    },
  },

  "settings.consistency": {
    label: "Books vs Commerce Settings",
    description: "The books' currency and business-day timezone match this installation's Commerce Settings (the dashboard's), so ledger dates and amounts line up with the dashboard's.",
    async run(ctx) {
      const commerce = await getCommerceSettings();
      const mismatches = [
        ...(commerce.currency !== ctx.business.baseCurrency ? [{ field: "currency", books: ctx.business.baseCurrency, commerce: commerce.currency }] : []),
        ...(commerce.timezone !== ctx.business.timezone ? [{ field: "timezone", books: ctx.business.timezone, commerce: commerce.timezone }] : []),
      ];
      return { status: mismatches.length ? "DIFFERENCE" : "MATCHED", expected: null, actual: null, details: { mismatches } };
    },
  },

  "treasury.integrity": {
    label: "Money movements and statement matching",
    description: "Every posted money movement has a posted journal of its amount on its accounts, every reversed one its reversal, and each statement line's matched amount equals the sum of its active matches — nothing derived has drifted from the ledger.",
    async run(ctx) {
      const movements = await prisma.$queryRaw<Array<{ id: string; problem: string }>>`
        SELECT m.id, CASE
            WHEN e.id IS NULL OR e.status <> 'POSTED' THEN 'posted movement without a posted journal'
            WHEN e."totalDebit" <> m.amount THEN 'journal amount differs from the movement'
            WHEN m.status = 'REVERSED' AND (r.id IS NULL OR r.status <> 'POSTED' OR r."reversesEntryId" <> e.id) THEN 'reversed movement without its reversal'
          END AS problem
        FROM "TreasuryMovement" m
        LEFT JOIN "JournalEntry" e ON e.id = m."journalEntryId"
        LEFT JOIN "JournalEntry" r ON r.id = m."reversalJournalEntryId"
        WHERE m."businessId" = ${ctx.business.id} AND m.status IN ('POSTED', 'REVERSED')
          AND (e.id IS NULL OR e.status <> 'POSTED' OR e."totalDebit" <> m.amount
               OR (m.status = 'REVERSED' AND (r.id IS NULL OR r.status <> 'POSTED' OR r."reversesEntryId" <> e.id)))
        LIMIT 50`;
      const drift = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT b.id FROM "BankTransaction" b
        WHERE b."businessId" = ${ctx.business.id}
          AND b."matchedAmount" <> COALESCE((SELECT SUM(m.amount) FROM "BankTransactionMatch" m WHERE m."bankTransactionId" = b.id AND m.status = 'ACTIVE'), 0)
        LIMIT 50`;
      return {
        status: movements.length === 0 && drift.length === 0 ? "MATCHED" : "DIFFERENCE",
        expected: null,
        actual: null,
        details: { movementProblems: movements, statementLinesWithMatchDrift: drift.map((d) => d.id) },
      };
    },
  },

  "revenue.dashboard_vs_ledger": {
    label: "Revenue: dashboard vs ledger",
    description: "The dashboard's realised net sales (metrics registry: merchandise sales − merchandise refunds, VAT-exclusive, at the dashboard's realisation moment) against the ledger's merchandise sales − sales returns for this brand.",
    async run(ctx, range) {
      const r = booksRange(ctx, range);
      if (!r) return { status: "NOT_APPLICABLE", details: { reason: ctx.business.openingDate ? "The range lies outside the books" : "The Financial Opening Date is not set" }, range: null };
      const cur = ctx.business.baseCurrency;
      const [dash, sums] = await Promise.all([dashboardMetric("realised_net_sales", r, cur), mappedSums(ctx, [RECONCILED_REVENUE_KEYS.revenue, RECONCILED_REVENUE_KEYS.contra], r)]);
      const rev = sums.get(RECONCILED_REVENUE_KEYS.revenue)!;
      const contra = sums.get(RECONCILED_REVENUE_KEYS.contra)!;
      const ledger = rev.credit - rev.debit - (contra.debit - contra.credit);
      const rules = commercePostingRules();
      return {
        status: compare(dash.minor, ledger),
        expected: dash.minor,
        actual: ledger,
        range: r,
        details: {
          dashboardMetric: "realised_net_sales",
          dashboardCoverage: dash.coverage,
          ledger: { merchandiseSales: toMajorNumber(rev.credit - rev.debit, cur), returnsAndRefunds: toMajorNumber(contra.debit - contra.credit, cur) },
          commercePostingRules: rules,
          ...(rules.length === 0 ? { note: "No commerce posting rules are registered yet (Phase 3): sales do not reach the ledger, so any dashboard revenue shows as a difference." } : {}),
        },
      };
    },
  },

  "cogs.dashboard_vs_ledger": {
    label: "Cost of goods sold: dashboard vs ledger",
    description: "The dashboard's recorded COGS (order-line cost snapshots; lines without a snapshot are excluded and counted) against the ledger's cost of goods sold for this brand.",
    async run(ctx, range) {
      const r = booksRange(ctx, range);
      if (!r) return { status: "NOT_APPLICABLE", details: { reason: ctx.business.openingDate ? "The range lies outside the books" : "The Financial Opening Date is not set" }, range: null };
      const cur = ctx.business.baseCurrency;
      const [dash, sums] = await Promise.all([dashboardMetric("cogs", r, cur), mappedSums(ctx, [RECONCILED_COGS_KEY], r)]);
      const cogs = sums.get(RECONCILED_COGS_KEY)!;
      const ledger = cogs.debit - cogs.credit;
      const rules = commercePostingRules();
      return {
        status: compare(dash.minor, ledger),
        expected: dash.minor,
        actual: ledger,
        range: r,
        details: {
          dashboardMetric: "cogs",
          /** Order lines in range with / without a recorded cost — the dashboard figure is incomplete by the missing ones. */
          dashboardCostCoverage: dash.coverage,
          ledgerLinesByValuation: { valued: cogs.valued, estimated: cogs.estimated, missing: cogs.missing },
          commercePostingRules: rules,
          ...(rules.length === 0 ? { note: "No commerce posting rules are registered yet (Phase 3): COGS does not reach the ledger, so any dashboard COGS shows as a difference." } : {}),
        },
      };
    },
  },

  "events.unposted": {
    label: "Financial events not posted",
    description: "Financial events that failed to post, or have waited more than 15 minutes, are listed — an event is never silently dropped.",
    async run(ctx) {
      const stale = new Date(Date.now() - 15 * 60_000);
      const where: Prisma.FinancialEventWhereInput = { businessId: ctx.business.id, OR: [{ status: "FAILED" }, { status: "RECEIVED", receivedAt: { lt: stale } }] };
      const [count, sample] = await Promise.all([
        prisma.financialEvent.count({ where }),
        prisma.financialEvent.findMany({ where, orderBy: { receivedAt: "asc" }, take: 20, select: { id: true, eventType: true, eventVersion: true, eventKey: true, status: true, attempts: true, lastError: true } }),
      ]);
      return { status: count === 0 ? "MATCHED" : "DIFFERENCE", expected: null, actual: null, details: { unposted: count, sample } };
    },
  },

  "cost.completeness": {
    label: "Cost data completeness",
    description: "Financial records whose amount depends on a product cost that is estimated or missing: opening inventory items and posted journal lines. Missing costs are never invented — they are listed here.",
    async run(ctx) {
      const cur = ctx.business.baseCurrency;
      const [inventory, lines] = await Promise.all([
        prisma.openingInventoryItem.groupBy({ by: ["valuationStatus"], where: { batch: { businessId: ctx.business.id } }, _count: { _all: true }, _sum: { quantity: true, valuationAmount: true } }),
        prisma.journalLine.groupBy({ by: ["valuationStatus"], where: { entry: { businessId: ctx.business.id, status: "POSTED" }, valuationStatus: { not: null } }, _count: { _all: true }, _sum: { debit: true, credit: true } }),
      ]);
      const inv = Object.fromEntries(inventory.map((g) => [g.valuationStatus, { items: g._count._all, quantity: g._sum.quantity ?? 0, value: toMajorNumber(toMinor(g._sum.valuationAmount, cur), cur) }]));
      const jl = Object.fromEntries(lines.map((g) => [g.valuationStatus!, { lines: g._count._all }]));
      const missing = (inv.MISSING?.items ?? 0) + (jl.MISSING?.lines ?? 0);
      const estimated = (inv.ESTIMATED?.items ?? 0) + (jl.ESTIMATED?.lines ?? 0);
      return {
        status: missing === 0 && estimated === 0 ? "MATCHED" : "DIFFERENCE",
        expected: null,
        actual: null,
        details: { openingInventory: inv, journalLines: jl, missingRecords: missing, estimatedRecords: estimated },
      };
    },
  },
} satisfies Record<string, ReconciliationCheck>;

export type ReconciliationCheckKey = keyof typeof RECONCILIATION_CHECKS;
export const RECONCILIATION_CHECK_KEYS = Object.keys(RECONCILIATION_CHECKS) as ReconciliationCheckKey[];

export function listReconciliationChecks() {
  return RECONCILIATION_CHECK_KEYS.map((key) => ({ key, label: RECONCILIATION_CHECKS[key].label, description: RECONCILIATION_CHECKS[key].description }));
}

/** Runs the given checks (default: all), records each run, and returns the results. A check that throws is recorded as ERROR. */
export async function runReconciliation(input: { checks?: string[]; from?: string; to?: string }, actor: FinanceActor) {
  const ctx = await getFinanceContext();
  const cur = ctx.business.baseCurrency;
  const keys = input.checks?.length ? input.checks : RECONCILIATION_CHECK_KEYS;
  for (const k of keys) if (!(k in RECONCILIATION_CHECKS)) throw financeError(400, "RECONCILIATION_CHECK_UNKNOWN", `Unknown check ${k}`, { known: RECONCILIATION_CHECK_KEYS });
  const results = [];
  for (const key of keys as ReconciliationCheckKey[]) {
    let result: CheckResult;
    try {
      result = await RECONCILIATION_CHECKS[key].run(ctx, { from: input.from, to: input.to });
    } catch (err) {
      result = { status: "ERROR", details: { error: err instanceof Error ? err.message : String(err) } };
    }
    const difference = result.expected != null && result.actual != null ? result.actual - result.expected : null;
    const run = await financeTransaction(async (tx) => {
      const row = await tx.reconciliationRun.create({
        data: {
          businessId: ctx.business.id,
          checkKey: key,
          fromDate: result.range ? dateColumn(result.range.from) : input.from ? dateColumn(input.from) : null,
          toDate: result.range ? dateColumn(result.range.to) : input.to ? dateColumn(input.to) : null,
          brandId: ctx.brand.id,
          status: result.status,
          expected: result.expected != null ? toDecimal(result.expected, cur) : null,
          actual: result.actual != null ? toDecimal(result.actual, cur) : null,
          difference: difference != null ? toDecimal(difference, cur) : null,
          details: result.details as Prisma.InputJsonValue,
          ranByAdminId: actor.type === "ADMIN" ? actor.adminId : null,
        },
      });
      await recordFinanceAudit(tx, { businessId: ctx.business.id, actor, action: "reconciliation.run", entityType: "ReconciliationRun", entityId: row.id, after: { checkKey: key, status: result.status, difference } });
      return row;
    });
    results.push(runDto(run, cur));
  }
  return { currency: cur, ok: results.every((r) => r.status === "MATCHED" || r.status === "NOT_APPLICABLE"), results };
}

function runDto(r: ReconciliationRun, cur: string) {
  const major = (v: Prisma.Decimal | null) => (v === null ? null : toMajorNumber(toMinor(v, cur), cur));
  return {
    id: r.id,
    checkKey: r.checkKey,
    status: r.status,
    from: r.fromDate ? r.fromDate.toISOString().slice(0, 10) : null,
    to: r.toDate ? r.toDate.toISOString().slice(0, 10) : null,
    brandId: r.brandId,
    expected: major(r.expected),
    actual: major(r.actual),
    difference: major(r.difference),
    details: r.details,
    ranByAdminId: r.ranByAdminId,
    createdAt: r.createdAt,
  };
}

export async function listReconciliationRuns(q: { checkKey?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where = { businessId: business.id, checkKey: q.checkKey };
  const [total, runs] = await Promise.all([
    prisma.reconciliationRun.count({ where }),
    prisma.reconciliationRun.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, runs: runs.map((r) => runDto(r, business.baseCurrency)) };
}

/** The scheduled run (jobs/finance-reconciliation-cron.ts). Does nothing on an installation whose books were never started
 * — a cron must not bootstrap a business. Differences are logged as warnings (and kept as runs). */
export async function scheduledReconciliation(): Promise<{ ran: boolean; differences: number }> {
  const business = await prisma.financeBusiness.findUnique({ where: { key: FINANCE_BUSINESS_KEY }, select: { openingDate: true } });
  if (!business?.openingDate) return { ran: false, differences: 0 };
  const { results } = await runReconciliation({}, { type: "SYSTEM", label: "system:reconciliation-cron" });
  const differences = results.filter((r) => r.status === "DIFFERENCE" || r.status === "ERROR");
  for (const d of differences) logger.warn(`[finance-reconciliation] ${d.checkKey}: ${d.status}${d.difference !== null ? ` (difference ${d.difference})` : ""}`);
  return { ran: true, differences: differences.length };
}
