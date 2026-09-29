import { customerStats, positionTotals, realisedAt, returnEvents } from "@clothing-brand/shared";
import { loadPositionFacts } from "../../domain/metrics/facts.repository";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { getCustomerInsights, getLowStockVariants, getDeadStockReport, getBestSellingPrediction } from "../analytics/analytics.service";
import { loadCustomersWithComputedFields } from "../customers/customer.service";
import { computeMetrics, loadFactsForRange } from "../../domain/metrics/metrics.service";
import { resolveStoreRange, storeContext, utcInstant } from "../../domain/metrics/store-time";
import { saleOrderSql } from "../../domain/metrics/sale-order";

const CACHE_TTL_SECONDS = 60;
const CACHE_KEY = "bi:executive-overview:v5";

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** The executive overview — every number is a registry metric (docs/METRICS_REGISTRY.md). "Revenue" is `net_sales`
 * (D1 realised revenue before the refund term, PD-5.1), with refunds, returns and collected cash shown beside it. */
export interface ExecutiveOverview {
  revenueToday: number;
  revenueYesterday: number;
  revenueThisWeek: number;
  revenueThisMonth: number;
  revenueLifetime: number;
  revenueGrowthPct: number;

  ordersLifetime: number;
  aovLifetime: number;

  grossProfitLifetime: number;
  profitGrowthPct: number;

  totalVisitors: number;
  returningVisitors: number;
  returningVisitorRatePct: number;

  conversionRatePct: number;
  customerLifetimeValue: number;
  repeatPurchaseRatePct: number;

  refundRatePct: number;
  returnRatePct: number;
  cancelledRatePct: number;

  inventoryValue: number;
  pendingPaymentsCount: number;
  pendingPaymentsAmount: number;

  // Phase 5 — the D1 financial breakdown for the current business month, and point-in-time ledger positions.
  grossMerchandiseThisMonth: number;
  discountsThisMonth: number;
  shippingThisMonth: number;
  returnsThisMonth: number;
  refundsThisMonth: number;
  collectedCashThisMonth: number;
  taxThisMonth: number;
  taxUnrecordedOrdersThisMonth: number;
  outstandingCod: number;
  refundDue: number;
}

export async function getExecutiveOverview(): Promise<ExecutiveOverview> {
  const cached = await cacheGet<ExecutiveOverview>(CACHE_KEY);
  if (cached) return cached;

  const now = new Date();
  const [today, yesterday, week, month, lastMonth, lifetime] = await Promise.all([
    resolveStoreRange({ preset: "today" }, now),
    resolveStoreRange({ preset: "yesterday" }, now),
    resolveStoreRange({ preset: "this_week" }, now),
    resolveStoreRange({ preset: "this_month" }, now),
    resolveStoreRange({ preset: "last_month" }, now),
    resolveStoreRange({ preset: "lifetime" }, now),
  ]);
  const { timezone, currency } = await storeContext();

  const [t, y, w, m, lm, life, monthFinance, positions, lifetimeFacts, visitorRows, sessionRows, pendingRows] = await Promise.all([
    computeMetrics({ metrics: ["net_sales"], range: today }),
    computeMetrics({ metrics: ["net_sales"], range: yesterday }),
    computeMetrics({ metrics: ["net_sales"], range: week }),
    computeMetrics({ metrics: ["net_sales", "gross_margin_estimated"], range: month }),
    computeMetrics({ metrics: ["net_sales", "gross_margin_estimated"], range: lastMonth }),
    computeMetrics({ metrics: ["net_sales", "orders_realised", "aov", "gross_margin_estimated", "orders_placed", "orders_cancelled", "inventory_value"], range: lifetime }),
    computeMetrics({
      metrics: ["gross_merchandise_sales", "discounts", "shipping_charged", "returns", "refunds", "collected_cash", "tax_collected"],
      range: month,
    }),
    computeMetrics({ metrics: ["outstanding_cod", "refund_due", "amount_due"], range: today }),
    loadFactsForRange(lifetime),
    // Visitors (behavioural): every distinct visitor; returning = active on > 1 business day (store timezone).
    prisma.$queryRaw<Array<{ totalVisitors: bigint; returningVisitors: bigint }>>`
      WITH per_visitor_days AS (
        SELECT "visitorId", COUNT(DISTINCT date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})) AS active_days
        FROM "PageView"
        WHERE "visitorId" IS NOT NULL
        GROUP BY "visitorId"
      )
      SELECT
        (SELECT COUNT(DISTINCT COALESCE("visitorId", 'sess:' || "sessionId")) FROM "PageView")::bigint AS "totalVisitors",
        (SELECT COUNT(*) FROM per_visitor_days WHERE active_days > 1)::bigint AS "returningVisitors"
    `,
    // Lifetime conversion = sessions that placed a sale order ÷ sessions.
    prisma.$queryRaw<Array<{ totalSessions: bigint; convertedSessions: bigint }>>`
      SELECT
        (SELECT COUNT(DISTINCT "sessionId") FROM "PageView")::bigint AS "totalSessions",
        (SELECT COUNT(DISTINCT o."sessionId") FROM "Order" o WHERE o."sessionId" IS NOT NULL AND ${saleOrderSql("o")} AND o."createdAt" < ${utcInstant(lifetime.endUtc)})::bigint AS "convertedSessions"
    `,
    // Orders with a balance still due — counted by the same ledger engine that sums `amount_due`.
    loadPositionFacts(currency).then((f) => positionTotals(f, currency).amountDueOrders),
  ]);

  // Rates over lifetime realised sale orders (facts): refunded = has a completed refund; returned = has returned units.
  const orders = lifetimeFacts.orders;
  const cs = customerStats(orders, lifetime);
  let realised = 0;
  let refunded = 0;
  let returned = 0;
  for (const o of orders) {
    if (!realisedAt(o)) continue;
    realised++;
    if (o.refunds.some((r) => r.status === "COMPLETED")) refunded++;
    if (returnEvents(o).length > 0) returned++;
  }
  const placed = life.metrics.orders_placed!.value;
  const cancelled = life.metrics.orders_cancelled!.value;

  const visitors = visitorRows[0]!;
  const sessions = sessionRows[0]!;
  const totalVisitors = Number(visitors.totalVisitors);
  const returningVisitors = Number(visitors.returningVisitors);
  const totalSessions = Number(sessions.totalSessions);
  const convertedSessions = Number(sessions.convertedSessions);
  const insights = await getCustomerInsights();

  const result: ExecutiveOverview = {
    revenueToday: t.metrics.net_sales!.value,
    revenueYesterday: y.metrics.net_sales!.value,
    revenueThisWeek: w.metrics.net_sales!.value,
    revenueThisMonth: m.metrics.net_sales!.value,
    revenueLifetime: life.metrics.net_sales!.value,
    revenueGrowthPct: pctChange(m.metrics.net_sales!.value, lm.metrics.net_sales!.value),

    ordersLifetime: life.metrics.orders_realised!.value,
    aovLifetime: life.metrics.aov!.value,

    grossProfitLifetime: life.metrics.gross_margin_estimated!.value,
    profitGrowthPct: pctChange(m.metrics.gross_margin_estimated!.value, lm.metrics.gross_margin_estimated!.value),

    totalVisitors,
    returningVisitors,
    returningVisitorRatePct: totalVisitors > 0 ? (returningVisitors / totalVisitors) * 100 : 0,

    conversionRatePct: totalSessions > 0 ? (convertedSessions / totalSessions) * 100 : 0,
    customerLifetimeValue: insights.avgClv,
    repeatPurchaseRatePct: cs.repeatCustomerRate * 100,

    refundRatePct: realised > 0 ? (refunded / realised) * 100 : 0,
    returnRatePct: realised > 0 ? (returned / realised) * 100 : 0,
    cancelledRatePct: placed + cancelled > 0 ? (cancelled / (placed + cancelled)) * 100 : 0,

    inventoryValue: life.metrics.inventory_value!.value,
    pendingPaymentsCount: pendingRows,
    pendingPaymentsAmount: positions.metrics.amount_due!.value,

    grossMerchandiseThisMonth: monthFinance.metrics.gross_merchandise_sales!.value,
    discountsThisMonth: monthFinance.metrics.discounts!.value,
    shippingThisMonth: monthFinance.metrics.shipping_charged!.value,
    returnsThisMonth: monthFinance.metrics.returns!.value,
    refundsThisMonth: monthFinance.metrics.refunds!.value,
    collectedCashThisMonth: monthFinance.metrics.collected_cash!.value,
    taxThisMonth: monthFinance.metrics.tax_collected!.value,
    taxUnrecordedOrdersThisMonth: monthFinance.metrics.tax_collected!.coverage?.missing ?? 0,
    outstandingCod: positions.metrics.outstanding_cod!.value,
    refundDue: positions.metrics.refund_due!.value,
  };

  await cacheSet(CACHE_KEY, result, CACHE_TTL_SECONDS);
  return result;
}

// ---------------------------------------------------------------------------
// Section 13 — AI Insights. Deliberately rule-based, not a trained model — thresholds evaluated
// against metrics that already exist elsewhere in the BI system (this is the composition layer, so
// it's the natural home for pulling several of them together into one feed). Labeled as such on the
// frontend rather than implied to be machine learning.
// ---------------------------------------------------------------------------

export interface AutomatedInsight {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

const INSIGHTS_CACHE_KEY = "bi:automated-insights:v5";

export async function getAutomatedInsights(): Promise<AutomatedInsight[]> {
  const cached = await cacheGet<AutomatedInsight[]>(INSIGHTS_CACHE_KEY);
  if (cached) return cached;

  const [overview, lowStock, deadStock, bestSelling, customers, { currency }] = await Promise.all([
    getExecutiveOverview(),
    getLowStockVariants(),
    getDeadStockReport(90, 5),
    getBestSellingPrediction(3),
    loadCustomersWithComputedFields({}),
    storeContext(),
  ]);

  const insights: AutomatedInsight[] = [];

  if (lowStock.length > 0) {
    insights.push({
      id: "low-stock",
      severity: lowStock.length > 10 ? "critical" : "warning",
      title: `${lowStock.length} variant${lowStock.length === 1 ? "" : "s"} low on stock`,
      detail: "Review restock priorities under Inventory Intelligence.",
    });
  }

  const deadStockValue = deadStock.reduce((sum, d) => sum + d.tiedUpValue, 0);
  if (deadStockValue > 0) {
    insights.push({
      id: "dead-stock",
      severity: "warning",
      title: `${currency} ${Math.round(deadStockValue).toLocaleString("en-US")} tied up in dead stock`,
      detail: `${deadStock.length} variant(s) with stock on hand but zero orders in the last 90 days.`,
    });
  }

  if (overview.revenueGrowthPct <= -10) {
    insights.push({
      id: "revenue-decline",
      severity: "critical",
      title: `Net sales down ${Math.abs(overview.revenueGrowthPct).toFixed(1)}% this month`,
      detail: "Compared to last month (realised net sales).",
    });
  } else if (overview.revenueGrowthPct >= 10) {
    insights.push({
      id: "revenue-growth",
      severity: "info",
      title: `Net sales up ${overview.revenueGrowthPct.toFixed(1)}% this month`,
      detail: "Compared to last month.",
    });
  }

  if (overview.returnRatePct >= 15) {
    insights.push({
      id: "return-rate",
      severity: "warning",
      title: `Return rate at ${overview.returnRatePct.toFixed(1)}%`,
      detail: "Higher than a healthy baseline — check the risk table under Product Intelligence.",
    });
  }

  if (overview.refundDue > 0) {
    insights.push({
      id: "refund-due",
      severity: "warning",
      title: `${currency} ${Math.round(overview.refundDue).toLocaleString("en-US")} owed back to customers`,
      detail: "Cancelled/returned orders or overpayments with money still held — see the orders refund queue.",
    });
  }

  const suspicious = customers.filter((c) => c.tags.includes("SUSPICIOUS")).length;
  if (suspicious > 0) {
    insights.push({
      id: "suspicious-customers",
      severity: "warning",
      title: `${suspicious} customer${suspicious === 1 ? "" : "s"} flagged as suspicious`,
      detail: "Review under Customers.",
    });
  }

  if (bestSelling.length > 0) {
    insights.push({
      id: "best-selling",
      severity: "info",
      title: `Likely best seller: ${bestSelling[0]!.name}`,
      detail: "Based on recent demand — see the prediction table below.",
    });
  }

  if (insights.length === 0) {
    insights.push({ id: "all-clear", severity: "info", title: "No automated alerts right now", detail: "Nothing has crossed a threshold yet." });
  }

  await cacheSet(INSIGHTS_CACHE_KEY, insights, 60);
  return insights;
}
