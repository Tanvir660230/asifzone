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
import { CLEARING_ACCOUNTS, RECONCILED_COGS_KEY, RECONCILED_REVENUE_KEYS, businessDate, compareBusinessDates, contributions, fromMajor, type AccountMappingKey } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { computeMetrics, loadFactsForRange } from "../metrics/metrics.service";
import { resolveStoreRange } from "../metrics/store-time";
import { getCommerceSettings } from "../config/commerce-settings";
import { logger } from "../../lib/observability/logger";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { FINANCE_BUSINESS_KEY, businessToday, getFinanceContext, type FinanceContext } from "./finance-context";
import { postingRuleKeys } from "./events.service";
import { dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { clearingBreakdown } from "./settlements.service";
import { inventoryLedgerBridge } from "./inventory-cutover.service";

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

/** Σ (credit − debit) × sign per order of POSTED lines on the mapped accounts, entry date in range, this brand. */
async function orderLedger(ctx: FinanceContext, keys: Array<{ key: AccountMappingKey; sign: 1 | -1 }>, range: { from: string; to: string }, valuation?: "KNOWN") {
  const cur = ctx.business.baseCurrency;
  const out = new Map<string, number>();
  for (const { key, sign } of keys) {
    const mapping = await prisma.accountMapping.findUnique({ where: { businessId_key: { businessId: ctx.business.id, key } } });
    if (!mapping) continue;
    const rows = await prisma.$queryRaw<Array<{ partyId: string | null; d: Prisma.Decimal; c: Prisma.Decimal }>>`
      SELECT l."partyId", COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
      WHERE e."businessId" = ${ctx.business.id} AND e.status = 'POSTED' AND l."accountId" = ${mapping.accountId}
        AND e."entryDate" BETWEEN ${dateColumn(range.from)}::date AND ${dateColumn(range.to)}::date
        AND COALESCE(l."brandId", e."brandId") = ${ctx.brand.id}
        ${valuation ? P.sql`AND (l."valuationStatus" IS NULL OR l."valuationStatus" = ${valuation}::"FinanceValuationStatus")` : P.empty}
      GROUP BY l."partyId"`;
    for (const r of rows) {
      const k = r.partyId ?? "(no order)";
      out.set(k, (out.get(k) ?? 0) + sign * (toMinor(r.c, cur) - toMinor(r.d, cur)));
    }
  }
  return out;
}

/** Order by order: the dashboard engine's contribution to `metric` in range vs the ledger's — the orders that differ. */
async function orderDifferences(ctx: FinanceContext, range: { from: string; to: string }, metric: "realised_net_sales" | "cogs", keys: Array<{ key: AccountMappingKey; sign: 1 | -1 }>, valuation?: "KNOWN") {
  const cur = ctx.business.baseCurrency;
  const businessRange = await resolveStoreRange({ from: range.from, to: range.to });
  const { orders } = await loadFactsForRange(businessRange);
  const engine = new Map<string, number>();
  for (const c of contributions(metric, orders, businessRange)) engine.set(c.order.id, (engine.get(c.order.id) ?? 0) + c.amount);
  const ledger = await orderLedger(ctx, keys, range, valuation);
  const numbers = new Map(orders.map((o) => [o.id, o.orderNumber]));
  const ids = new Set([...engine.keys(), ...ledger.keys()]);
  return [...ids]
    .map((id) => ({ orderId: id, orderNumber: numbers.get(id) ?? null, dashboard: engine.get(id) ?? 0, ledger: ledger.get(id) ?? 0 }))
    .filter((x) => x.dashboard !== x.ledger)
    .slice(0, 100)
    .map((x) => ({ ...x, dashboard: toMajorNumber(x.dashboard, cur), ledger: toMajorNumber(x.ledger, cur), difference: toMajorNumber(x.ledger - x.dashboard, cur) }));
}

/** The latest revision's status per commerce fact (entityType:entityId), POSTED meaning its effect is in the books. */
async function liveFacts(ctx: FinanceContext): Promise<Map<string, string>> {
  const rows = await prisma.financialEvent.findMany({ where: { businessId: ctx.business.id, sourceSystem: "commerce" }, select: { eventKey: true, sourceEntityType: true, sourceEntityId: true, status: true, payload: true } });
  const latest = new Map<string, { rev: number; status: string }>();
  for (const r of rows) {
    const rev = Number(/#r(\d+)$/.exec(r.eventKey)?.[1] ?? 0);
    const k = `${r.sourceEntityType}:${r.sourceEntityId}`;
    const status = (r.payload as { void?: boolean }).void ? "VOID" : r.status;
    const cur = latest.get(k);
    if (!cur || rev > cur.rev) latest.set(k, { rev, status });
  }
  return new Map([...latest].map(([k, v]) => [k, v.status]));
}

const commercePostingRules = () => postingRuleKeys().filter((k) => k.startsWith("commerce."));

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
    description: "The dashboard's realised net sales (merchandise sales − merchandise refunds, VAT-exclusive, at the dashboard's realisation moment) against the ledger's merchandise sales − sales returns for this brand — total, and order by order.",
    async run(ctx, range) {
      const r = booksRange(ctx, range);
      if (!r) return { status: "NOT_APPLICABLE", details: { reason: ctx.business.openingDate ? "The range lies outside the books" : "The Financial Opening Date is not set" }, range: null };
      const cur = ctx.business.baseCurrency;
      const [dash, sums] = await Promise.all([dashboardMetric("realised_net_sales", r, cur), mappedSums(ctx, [RECONCILED_REVENUE_KEYS.revenue, RECONCILED_REVENUE_KEYS.contra], r)]);
      const rev = sums.get(RECONCILED_REVENUE_KEYS.revenue)!;
      const contra = sums.get(RECONCILED_REVENUE_KEYS.contra)!;
      const ledger = rev.credit - rev.debit - (contra.debit - contra.credit);
      const status = compare(dash.minor, ledger);
      return {
        status,
        expected: dash.minor,
        actual: ledger,
        range: r,
        details: {
          dashboardMetric: "realised_net_sales",
          dashboardCoverage: dash.coverage,
          ledger: { merchandiseSales: toMajorNumber(rev.credit - rev.debit, cur), returnsAndRefunds: toMajorNumber(contra.debit - contra.credit, cur) },
          commercePostingRules: commercePostingRules(),
          ...(status === "DIFFERENCE"
            ? { orders: await orderDifferences(ctx, r, "realised_net_sales", [{ key: RECONCILED_REVENUE_KEYS.revenue, sign: 1 }, { key: RECONCILED_REVENUE_KEYS.contra, sign: 1 }]) }
            : {}),
        },
      };
    },
  },

  "cogs.dashboard_vs_ledger": {
    label: "Cost of goods sold: dashboard vs ledger",
    description: "The dashboard's recorded COGS (order-line cost snapshots; lines without one are excluded) against the ledger's cost of goods sold at KNOWN cost for this brand — total and order by order. Approved estimates and missing costs are reported, never mixed in.",
    async run(ctx, range) {
      const r = booksRange(ctx, range);
      if (!r) return { status: "NOT_APPLICABLE", details: { reason: ctx.business.openingDate ? "The range lies outside the books" : "The Financial Opening Date is not set" }, range: null };
      const cur = ctx.business.baseCurrency;
      const [dash, sums, known, missing] = await Promise.all([
        dashboardMetric("cogs", r, cur),
        mappedSums(ctx, [RECONCILED_COGS_KEY], r),
        orderLedger(ctx, [{ key: RECONCILED_COGS_KEY, sign: -1 }], r, "KNOWN"),
        prisma.financeException.findMany({ where: { businessId: ctx.business.id, kind: "MISSING_COST", status: { not: "RESOLVED" } }, select: { orderNumber: true, title: true, amount: true }, take: 50 }),
      ]);
      const cogs = sums.get(RECONCILED_COGS_KEY)!;
      const ledgerKnown = [...known.values()].reduce((s, v) => s + v, 0);
      const status = compare(dash.minor, ledgerKnown);
      return {
        status,
        expected: dash.minor,
        actual: ledgerKnown,
        range: r,
        details: {
          dashboardMetric: "cogs",
          /** Order lines in range with / without a recorded cost — the dashboard figure is incomplete by the missing ones. */
          dashboardCostCoverage: dash.coverage,
          ledgerTotalAllValuations: toMajorNumber(cogs.debit - cogs.credit, cur),
          ledgerLinesByValuation: { valued: cogs.valued, estimated: cogs.estimated, missing: cogs.missing },
          openMissingCosts: missing.map((m) => ({ orderNumber: m.orderNumber, title: m.title })),
          ...(status === "DIFFERENCE" ? { orders: await orderDifferences(ctx, r, "cogs", [{ key: RECONCILED_COGS_KEY, sign: -1 }], "KNOWN") } : {}),
        },
      };
    },
  },

  "commerce.facts_posted": {
    label: "Commerce facts in the books",
    description: "Every successful payment, completed refund and store-credit entry dated in the books has its accounting event posted — anything missing or failing is listed by record.",
    async run(ctx, range) {
      const r = booksRange(ctx, range);
      if (!r) return { status: "NOT_APPLICABLE", details: { reason: "The Financial Opening Date is not set" }, range: null };
      const tz = ctx.business.timezone;
      const inBooks = (d: Date) => businessDate(d, tz) >= r.from && businessDate(d, tz) <= r.to;
      const window = { gte: new Date(new Date(`${r.from}T00:00:00Z`).getTime() - 86_400_000), lte: new Date(new Date(`${r.to}T00:00:00Z`).getTime() + 2 * 86_400_000) };
      const [payments, refunds, credits] = await Promise.all([
        prisma.payment.findMany({ where: { status: "SUCCEEDED", amount: { gt: 0 }, orderId: { not: null }, settledAt: window }, select: { id: true, orderId: true, settledAt: true, amount: true, provider: true } }),
        prisma.refund.findMany({ where: { status: "COMPLETED", completedAt: window }, select: { id: true, orderId: true, completedAt: true, amount: true } }),
        prisma.customerCreditEntry.findMany({ where: { createdAt: window }, select: { id: true, orderId: true, createdAt: true, amount: true, type: true } }),
      ]);
      const live = await liveFacts(ctx);
      const missing = [
        ...payments.filter((p) => inBooks(p.settledAt) && live.get(`Payment:${p.id}`) !== "POSTED").map((p) => ({ record: "Payment", id: p.id, orderId: p.orderId, amount: p.amount.toString(), state: live.get(`Payment:${p.id}`) ?? "NOT_RECORDED" })),
        ...refunds.filter((x) => x.completedAt && inBooks(x.completedAt) && live.get(`Refund:${x.id}`) !== "POSTED").map((x) => ({ record: "Refund", id: x.id, orderId: x.orderId, amount: x.amount.toString(), state: live.get(`Refund:${x.id}`) ?? "NOT_RECORDED" })),
        ...credits.filter((c) => inBooks(c.createdAt) && live.get(`CustomerCreditEntry:${c.id}`) !== "POSTED").map((c) => ({ record: "CustomerCreditEntry", id: c.id, orderId: c.orderId, amount: c.amount.toString(), state: live.get(`CustomerCreditEntry:${c.id}`) ?? "NOT_RECORDED" })),
      ];
      // A store-credit entry with no accounting meaning is an exception, not a missing posting.
      const excepted = new Set((await prisma.financeException.findMany({ where: { businessId: ctx.business.id, kind: "UNSUPPORTED_CREDIT_ENTRY" }, select: { sourceId: true } })).map((e) => e.sourceId));
      const unexplained = missing.filter((m) => !(m.record === "CustomerCreditEntry" && excepted.has(m.id)));
      return {
        status: unexplained.length ? "DIFFERENCE" : "MATCHED", expected: null, actual: null, range: r,
        details: { payments: payments.filter((p) => inBooks(p.settledAt)).length, refunds: refunds.filter((x) => x.completedAt && inBooks(x.completedAt)).length, storeCreditEntries: credits.filter((c) => inBooks(c.createdAt)).length, notPosted: unexplained.slice(0, 100) },
      };
    },
  },

  "commerce.duplicates": {
    label: "No fact posted twice",
    description: "No commerce fact has more than one posted, unreversed journal — retries, repeated syncs and concurrent runs never doubled money.",
    async run(ctx) {
      const rows = await prisma.$queryRaw<Array<{ semantic: string; n: bigint }>>`
        SELECT split_part(ev."eventKey", '#', 1) AS semantic, COUNT(*) AS n
        FROM "FinancialEvent" ev JOIN "JournalEntry" j ON j."financialEventId" = ev.id
        WHERE ev."businessId" = ${ctx.business.id} AND ev."sourceSystem" = 'commerce' AND j.status = 'POSTED'
          AND NOT EXISTS (SELECT 1 FROM "JournalEntry" r WHERE r."reversesEntryId" = j.id AND r.status = 'POSTED')
        GROUP BY 1 HAVING COUNT(*) > 1 LIMIT 50`;
      return { status: rows.length ? "DIFFERENCE" : "MATCHED", expected: null, actual: null, details: { duplicated: rows.map((r) => ({ fact: r.semantic, liveJournals: Number(r.n) })) } };
    },
  },

  "clearing.positions": {
    label: "Clearing accounts (COD, gateways, manual receipts)",
    description: "Per clearing account and order: what customers paid in versus what recorded settlements took out. Money still in clearing is listed (in transit); a settlement for more than an order paid, or a settlement line with no order, is a difference.",
    async run(ctx) {
      const cur = ctx.business.baseCurrency;
      const mapped = await prisma.accountMapping.findMany({ where: { businessId: ctx.business.id, key: { in: CLEARING_ACCOUNTS.map((c) => c.key) } }, include: { account: { include: { financialAccount: true } } } });
      const accounts = [];
      let problems = 0;
      for (const m of mapped) {
        // Per order: paid in (debits), taken out by settlements, taken out by gateway refunds — kept apart, so a refund made
        // after the order was settled (the gateway deducts it from a later payout) is not mistaken for an over-settlement.
        // Reversals count against the entry they reverse (clearingBreakdown).
        const open = (await clearingBreakdown(ctx.business.id, m.accountId, cur))
          .map((x) => ({ orderId: x.orderId, paidIn: x.paid, settled: x.settled, refunded: x.other, balance: x.balance }))
          .filter((x) => x.balance !== 0 || x.settled > x.paidIn);
        const oversettled = open.filter((x) => x.orderId && x.settled > x.paidIn);
        const unattributed = open.filter((x) => !x.orderId);
        problems += oversettled.length + unattributed.filter((x) => x.balance < 0).length;
        accounts.push({
          key: m.key, account: m.account.financialAccount?.name ?? m.account.name,
          balance: toMajorNumber(open.reduce((s, x) => s + x.balance, 0), cur),
          inTransitOrders: open.filter((x) => x.orderId && x.balance > 0).length,
          inTransitAmount: toMajorNumber(open.filter((x) => x.orderId && x.balance > 0).reduce((s, x) => s + x.balance, 0), cur),
          oversettled: oversettled.slice(0, 50).map((x) => ({ orderId: x.orderId, paidIn: toMajorNumber(x.paidIn, cur), settled: toMajorNumber(x.settled, cur) })),
          refundsAwaitingDeduction: open.filter((x) => x.orderId && x.balance < 0 && x.settled <= x.paidIn).length,
          settledWithoutOrder: toMajorNumber(-unattributed.reduce((s, x) => s + x.balance, 0), cur),
        });
      }
      const unmatchedLines = await prisma.clearingSettlementLine.count({ where: { matchStatus: "UNMATCHED", settlement: { businessId: ctx.business.id, status: "POSTED" } } });
      return { status: problems || unmatchedLines ? "DIFFERENCE" : "MATCHED", expected: null, actual: null, details: { accounts, unmatchedSettlementLines: unmatchedLines } };
    },
  },

  "commerce.receivables": {
    label: "Order receivables",
    description: "An order's receivable (what it charged − what was paid + what was refunded …) should be zero once commerce says it is settled. Orders where the books still show money owed either way are listed.",
    async run(ctx) {
      const cur = ctx.business.baseCurrency;
      const mapping = await prisma.accountMapping.findUnique({ where: { businessId_key: { businessId: ctx.business.id, key: "asset.receivable_trade" } } });
      if (!mapping) return { status: "ERROR", details: { error: "asset.receivable_trade is not mapped" } };
      const rows = await prisma.$queryRaw<Array<{ partyId: string; d: Prisma.Decimal; c: Prisma.Decimal }>>`
        SELECT l."partyId", COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
        FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
        WHERE e."businessId" = ${ctx.business.id} AND e.status = 'POSTED' AND l."accountId" = ${mapping.accountId} AND l."partyType" = 'Order'
        GROUP BY l."partyId"`;
      const nonzero = rows.map((x) => ({ orderId: x.partyId, balance: toMinor(x.d, cur) - toMinor(x.c, cur) })).filter((x) => x.balance !== 0);
      const orders = new Map((await prisma.order.findMany({ where: { id: { in: nonzero.map((x) => x.orderId) } }, select: { id: true, orderNumber: true, status: true, paymentStatus: true } })).map((o) => [o.id, o]));
      const SETTLED = new Set(["PAID", "REFUNDED", "CREDITED"]);
      const unexpected = nonzero.filter((x) => SETTLED.has(orders.get(x.orderId)?.paymentStatus ?? ""));
      return {
        status: unexpected.length ? "DIFFERENCE" : "MATCHED", expected: null, actual: null,
        details: {
          openReceivables: nonzero.length,
          settledButOpen: unexpected.slice(0, 100).map((x) => ({ orderId: x.orderId, orderNumber: orders.get(x.orderId)?.orderNumber ?? null, status: orders.get(x.orderId)?.status ?? null, paymentStatus: orders.get(x.orderId)?.paymentStatus ?? null, balance: toMajorNumber(x.balance, cur) })),
        },
      };
    },
  },

  "finance.exceptions": {
    label: "Open finance exceptions",
    description: "Accounting problems waiting for a decision: missing costs, stock moved without a value, unmatched settlement lines, orders whose totals don't add up.",
    async run(ctx) {
      const open = await prisma.financeException.groupBy({ by: ["kind"], where: { businessId: ctx.business.id, status: "OPEN" }, _count: { _all: true } });
      const n = open.reduce((s, g) => s + g._count._all, 0);
      return { status: n ? "DIFFERENCE" : "MATCHED", expected: null, actual: null, details: { open: Object.fromEntries(open.map((g) => [g.kind, g._count._all])) } };
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

  // ── Phase 4B: inventory costing (docs/FINANCE_PHASE_4.md §9) — not applicable until costing is activated (4C) ──────
  "inventory.order_cost_links": {
    label: "Order-line cost = stock-exit valuation",
    description: "Every order line costed from inventory is linked to the stock exit it left with, and its recorded unit cost is exactly that exit's valuation — the dashboard's COGS, the books' COGS and the inventory valuation are one number. Lines are also counted by where their cost came from (inventory, provisional, catalog, none).",
    async run(ctx) {
      const active = await prisma.financeBusiness.findUnique({ where: { id: ctx.business.id }, select: { inventoryCostingActivatedAt: true } });
      const sources = await prisma.orderItem.groupBy({ by: ["unitCostSource"], _count: { _all: true } });
      const bySource = Object.fromEntries(sources.map((g) => [g.unitCostSource ?? "BEFORE_PHASE_4B", g._count._all]));
      if (!active?.inventoryCostingActivatedAt) return { status: "NOT_APPLICABLE", details: { reason: "inventory costing is not active (activated by the 4C valuation cutover)", linesByCostSource: bySource } };
      const unlinked = await prisma.orderItem.findMany({ where: { unitCostSource: { in: ["INVENTORY", "INVENTORY_PROVISIONAL"] }, costMovementId: null }, select: { id: true, orderId: true, variantId: true }, take: 50 });
      const diverged = await prisma.$queryRaw<Array<{ id: string; orderId: string; snapshot: number | null; valuation: number | null }>>`
        SELECT i.id, i."orderId", i."unitCostSnapshot" AS snapshot, e."unitCostMinor" AS valuation
        FROM "OrderItem" i JOIN "InventoryValuationEntry" e ON e."stockMovementId" = i."costMovementId"
        WHERE i."costMovementId" IS NOT NULL AND e."unitCostMinor" IS DISTINCT FROM i."unitCostSnapshot" LIMIT 50`;
      return { status: unlinked.length || diverged.length ? "DIFFERENCE" : "MATCHED", details: { unlinkedLines: unlinked, divergedLines: diverged, linesByCostSource: bySource } };
    },
  },

  "inventory.quantity_vs_valuation": {
    label: "Stock quantity = valuation position",
    description: "For every costed variant: physical stock (inventory.service's) equals valued + unvalued − units issued short (the costing position), and every stock movement since the variant entered costing has exactly one valuation entry.",
    async run(ctx) {
      const active = await prisma.financeBusiness.findUnique({ where: { id: ctx.business.id }, select: { inventoryCostingActivatedAt: true } });
      if (!active?.inventoryCostingActivatedAt) return { status: "NOT_APPLICABLE", details: { reason: "inventory costing is not active (activated by the 4C valuation cutover)" } };
      const quantity = await prisma.$queryRaw<Array<{ variantId: string; sku: string; stock: number; position: number }>>`
        SELECT s."variantId", v.sku, v.stock, (s."valuedQty" + s."unvaluedQty" - s."deficitQty") AS position
        FROM "InventoryCostState" s JOIN "ProductVariant" v ON v.id = s."variantId"
        WHERE s."businessId" = ${ctx.business.id} AND v.stock <> s."valuedQty" + s."unvaluedQty" - s."deficitQty" LIMIT 50`;
      const unvalued = await prisma.$queryRaw<Array<{ movementId: string; variantId: string; reason: string; change: number }>>`
        SELECT m.id AS "movementId", m."variantId", m.reason::text AS reason, m.change
        FROM "StockMovement" m
        JOIN (SELECT "variantId", MIN(sequence) AS first FROM "InventoryValuationEntry" WHERE "businessId" = ${ctx.business.id} GROUP BY "variantId") f ON f."variantId" = m."variantId"
        JOIN "InventoryValuationEntry" fe ON fe.sequence = f.first
        LEFT JOIN "InventoryValuationEntry" e ON e."stockMovementId" = m.id
        WHERE m."createdAt" >= fe."createdAt" AND e.id IS NULL AND m.change <> 0 AND (fe."stockMovementId" IS NULL OR m.id <> fe."stockMovementId") LIMIT 50`;
      return { status: quantity.length || unvalued.length ? "DIFFERENCE" : "MATCHED", details: { quantityMismatches: quantity, movementsWithoutValuation: unvalued } };
    },
  },

  "inventory.valuation_postings": {
    label: "Valuation postings in the books",
    description: "Every valuation entry that moves the ledger (a cost adjustment to 5150, or a manual adjustment's own value) has its inventory.valued event posted, with the amounts of the entry — the inventory account and the valuation converge through explicit journals, never by editing history.",
    async run(ctx) {
      const active = await prisma.financeBusiness.findUnique({ where: { id: ctx.business.id }, select: { inventoryCostingActivatedAt: true } });
      if (!active?.inventoryCostingActivatedAt) return { status: "NOT_APPLICABLE", details: { reason: "inventory costing is not active (activated by the 4C valuation cutover)" } };
      const cur = ctx.business.baseCurrency;
      const rows = await prisma.$queryRaw<Array<{ entryId: string; adjustment: Prisma.Decimal; eventStatus: string | null; payloadAdjustment: number | null }>>`
        SELECT e.id AS "entryId", e."costAdjustment" AS adjustment, fe.status::text AS "eventStatus", (fe.payload->>'costAdjustmentMinor')::bigint::int AS "payloadAdjustment"
        FROM "InventoryValuationEntry" e
        LEFT JOIN "FinancialEvent" fe ON fe."businessId" = e."businessId" AND fe."eventKey" = 'valuation:' || e.id
        WHERE e."businessId" = ${ctx.business.id} AND (e."costAdjustment" <> 0 OR fe.id IS NOT NULL)`;
      const problems = rows
        .map((r) => ({ entryId: r.entryId, adjustment: toMinor(r.adjustment, cur), eventStatus: r.eventStatus, posted: r.payloadAdjustment }))
        .filter((r) => r.eventStatus !== "POSTED" || r.posted !== r.adjustment);
      return { status: problems.length ? "DIFFERENCE" : "MATCHED", details: { entriesWithPostings: rows.length, problems: problems.slice(0, 50) } };
    },
  },

  // ── Phase 4C: the valuation cutover set the inventory account equal to valuation + in-transit ──────────────────────
  "inventory.valuation_vs_ledger": {
    label: "Inventory account = valuation",
    description: "The inventory account's balance equals the valuation ledger's total value, plus the cost of units already out to orders whose cost of sales is not booked yet (in transit), less inventory booked at approved estimates since the cutover (units the valuation never held a cost for).",
    async run(ctx) {
      const active = await prisma.financeBusiness.findUnique({ where: { id: ctx.business.id }, select: { inventoryCostingActivatedAt: true } });
      if (!active?.inventoryCostingActivatedAt) return { status: "NOT_APPLICABLE", details: { reason: "inventory costing is not active (activated by the 4C valuation cutover)" } };
      const cur = ctx.business.baseCurrency;
      const b = await inventoryLedgerBridge(prisma, ctx.business, { estimatedSince: active.inventoryCostingActivatedAt });
      const expected = b.valuationMinor + b.inTransitMinor - b.estimatedSinceMinor;
      return {
        status: expected === b.ledgerMinor ? "MATCHED" : "DIFFERENCE",
        expected,
        actual: b.ledgerMinor,
        details: {
          valuation: toMajorNumber(b.valuationMinor, cur),
          inTransit: toMajorNumber(b.inTransitMinor, cur),
          inTransitOrders: b.inTransit.orders,
          estimatedSinceCutover: toMajorNumber(b.estimatedSinceMinor, cur),
        },
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
