import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { getCustomerInsights, getLowStockVariants, getDeadStockReport, getBestSellingPrediction } from "../analytics/analytics.service";
import { loadCustomersWithComputedFields } from "../customers/customer.service";

const CACHE_TTL_SECONDS = 60;
const CACHE_KEY = "bi:executive-overview";

/** Naive-timestamp-in-Dhaka-local-time idiom used throughout `analytics.service.ts`
 * (see getTrafficHeatmap): every `createdAt` column is stored as `timestamp` (no time zone),
 * written in UTC — `AT TIME ZONE 'UTC'` first turns that naive UTC value into a real instant,
 * then `AT TIME ZONE 'Asia/Dhaka'` converts that instant into Dhaka's naive local wall-clock time,
 * so it can be compared against calendar boundaries computed the same way from NOW().
 *
 * Wrapped in `Prisma.raw` (not plain string interpolation) because this needs to land in the
 * query as literal SQL, not a bound parameter — safe here since the input is always one of the
 * fixed column references below, never external/user data. */
const dhakaLocal = (column: string) => Prisma.raw(`(${column} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')`);

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

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
}

export async function getExecutiveOverview(): Promise<ExecutiveOverview> {
  const cached = await cacheGet<ExecutiveOverview>(CACHE_KEY);
  if (cached) return cached;

  const localOrderCreated = dhakaLocal(`o."createdAt"`);
  const localOrderItemOrderCreated = dhakaLocal(`o2."createdAt"`);
  const localPageViewCreated = dhakaLocal(`"createdAt"`);

  const [revenueRows, cogsRows, visitorRows, sessionRows, customerInsights, rateRows, inventoryRows, pendingRows] = await Promise.all([
    // Revenue across every period a business owner checks first thing — all excl. CANCELLED,
    // matching the NON_REVENUE_STATUSES convention in analytics.service.ts.
    prisma.$queryRaw<
      Array<{
        today: number;
        yesterday: number;
        week: number;
        month: number;
        lastMonth: number;
        lifetime: number;
        lifetimeOrders: bigint;
      }>
    >`
      WITH bounds AS (
        SELECT
          date_trunc('day', NOW() AT TIME ZONE 'Asia/Dhaka') AS today_start,
          date_trunc('day', NOW() AT TIME ZONE 'Asia/Dhaka') - INTERVAL '1 day' AS yesterday_start,
          date_trunc('week', NOW() AT TIME ZONE 'Asia/Dhaka') AS week_start,
          date_trunc('month', NOW() AT TIME ZONE 'Asia/Dhaka') AS month_start,
          date_trunc('month', NOW() AT TIME ZONE 'Asia/Dhaka') - INTERVAL '1 month' AS last_month_start
      )
      SELECT
        COALESCE(SUM(o.total) FILTER (WHERE ${localOrderCreated} >= b.today_start), 0)::float AS today,
        COALESCE(SUM(o.total) FILTER (WHERE ${localOrderCreated} >= b.yesterday_start AND ${localOrderCreated} < b.today_start), 0)::float AS yesterday,
        COALESCE(SUM(o.total) FILTER (WHERE ${localOrderCreated} >= b.week_start), 0)::float AS week,
        COALESCE(SUM(o.total) FILTER (WHERE ${localOrderCreated} >= b.month_start), 0)::float AS month,
        COALESCE(SUM(o.total) FILTER (WHERE ${localOrderCreated} >= b.last_month_start AND ${localOrderCreated} < b.month_start), 0)::float AS "lastMonth",
        COALESCE(SUM(o.total), 0)::float AS lifetime,
        COUNT(*)::bigint AS "lifetimeOrders"
      FROM "Order" o CROSS JOIN bounds b
      WHERE o.status != 'CANCELLED'
    `,
    // Gross profit is estimated against *current* cost price — OrderItem never snapshotted cost at
    // sale time, only priceSnapshot. Close enough for a trend signal, not exact historical margin.
    prisma.$queryRaw<Array<{ lifetime: number; month: number; lastMonth: number }>>`
      WITH bounds AS (
        SELECT
          date_trunc('month', NOW() AT TIME ZONE 'Asia/Dhaka') AS month_start,
          date_trunc('month', NOW() AT TIME ZONE 'Asia/Dhaka') - INTERVAL '1 month' AS last_month_start
      )
      SELECT
        COALESCE(SUM(oi.quantity * COALESCE(pv."costPrice", p."costPrice", 0)), 0)::float AS lifetime,
        COALESCE(SUM(oi.quantity * COALESCE(pv."costPrice", p."costPrice", 0)) FILTER (WHERE ${localOrderItemOrderCreated} >= b.month_start), 0)::float AS month,
        COALESCE(SUM(oi.quantity * COALESCE(pv."costPrice", p."costPrice", 0)) FILTER (WHERE ${localOrderItemOrderCreated} >= b.last_month_start AND ${localOrderItemOrderCreated} < b.month_start), 0)::float AS "lastMonth"
      FROM "OrderItem" oi
      JOIN "Order" o2 ON o2.id = oi."orderId"
      LEFT JOIN "ProductVariant" pv ON pv.id = oi."variantId"
      LEFT JOIN "Product" p ON p.id = pv."productId"
      CROSS JOIN bounds b
      WHERE o2.status != 'CANCELLED'
    `,
    // Total = every distinct visitor seen, falling back to sessionId for pre-migration rows that
    // predate the visitorId cookie. Returning = a visitorId whose pageviews span >1 calendar day —
    // rows with no visitorId can't be evaluated for "returning" status, so they never count toward
    // that numerator (an undercount until the cookie has had time to roll out, not a bug).
    prisma.$queryRaw<Array<{ totalVisitors: bigint; returningVisitors: bigint }>>`
      WITH per_visitor_days AS (
        SELECT "visitorId", COUNT(DISTINCT date_trunc('day', ${localPageViewCreated})) AS active_days
        FROM "PageView"
        WHERE "visitorId" IS NOT NULL
        GROUP BY "visitorId"
      )
      SELECT
        (SELECT COUNT(DISTINCT COALESCE("visitorId", 'sess:' || "sessionId")) FROM "PageView")::bigint AS "totalVisitors",
        (SELECT COUNT(*) FROM per_visitor_days WHERE active_days > 1)::bigint AS "returningVisitors"
    `,
    // Lifetime conversion rate — same converted-session/total-session definition as
    // getConversionFunnel, just unwindowed.
    prisma.$queryRaw<Array<{ totalSessions: bigint; convertedSessions: bigint }>>`
      SELECT
        (SELECT COUNT(DISTINCT "sessionId") FROM "PageView")::bigint AS "totalSessions",
        (SELECT COUNT(DISTINCT "sessionId") FROM "Order" WHERE "sessionId" IS NOT NULL AND status != 'CANCELLED')::bigint AS "convertedSessions"
    `,
    getCustomerInsights(),
    // Refund/return rate use lifetime non-cancelled orders as the denominator (a cancelled order
    // never reached fulfillment, so it can't itself be returned/refunded); cancelled rate is the
    // one metric that needs *every* order ever placed, cancelled included, as its denominator.
    prisma.$queryRaw<
      Array<{ nonCancelledOrders: bigint; allOrders: bigint; refundedOrders: bigint; cancelledOrders: bigint; returnedOrders: bigint }>
    >`
      SELECT
        (SELECT COUNT(*) FROM "Order" WHERE status != 'CANCELLED')::bigint AS "nonCancelledOrders",
        (SELECT COUNT(*) FROM "Order")::bigint AS "allOrders",
        (SELECT COUNT(*) FROM "Order" WHERE "paymentStatus" = 'REFUNDED' OR status = 'REFUNDED')::bigint AS "refundedOrders",
        (SELECT COUNT(*) FROM "Order" WHERE status = 'CANCELLED')::bigint AS "cancelledOrders",
        (SELECT COUNT(DISTINCT "orderId") FROM "ReturnRequest")::bigint AS "returnedOrders"
    `,
    prisma.$queryRaw<Array<{ value: number }>>`
      SELECT COALESCE(SUM(pv.stock * COALESCE(pv."costPrice", p."costPrice", 0)), 0)::float AS value
      FROM "ProductVariant" pv
      JOIN "Product" p ON p.id = pv."productId"
      WHERE p."isActive" = true AND p."deletedAt" IS NULL
    `,
    prisma.$queryRaw<Array<{ count: bigint; amount: number }>>`
      SELECT COUNT(*)::bigint AS count, COALESCE(SUM(total), 0)::float AS amount
      FROM "Order"
      WHERE "paymentStatus" = 'UNPAID' AND status != 'CANCELLED'
    `,
  ]);

  const revenue = revenueRows[0]!;
  const cogs = cogsRows[0]!;
  const visitors = visitorRows[0]!;
  const sessions = sessionRows[0]!;
  const rates = rateRows[0]!;
  const inventoryValue = inventoryRows[0]?.value ?? 0;
  const pending = pendingRows[0]!;

  const lifetimeOrders = Number(revenue.lifetimeOrders);
  const totalVisitors = Number(visitors.totalVisitors);
  const returningVisitors = Number(visitors.returningVisitors);
  const totalSessions = Number(sessions.totalSessions);
  const convertedSessions = Number(sessions.convertedSessions);
  const nonCancelledOrders = Number(rates.nonCancelledOrders);
  const allOrders = Number(rates.allOrders);

  const profitThisMonth = revenue.month - cogs.month;
  const profitLastMonth = revenue.lastMonth - cogs.lastMonth;

  const result: ExecutiveOverview = {
    revenueToday: revenue.today,
    revenueYesterday: revenue.yesterday,
    revenueThisWeek: revenue.week,
    revenueThisMonth: revenue.month,
    revenueLifetime: revenue.lifetime,
    revenueGrowthPct: pctChange(revenue.month, revenue.lastMonth),

    ordersLifetime: lifetimeOrders,
    aovLifetime: lifetimeOrders > 0 ? revenue.lifetime / lifetimeOrders : 0,

    grossProfitLifetime: revenue.lifetime - cogs.lifetime,
    profitGrowthPct: pctChange(profitThisMonth, profitLastMonth),

    totalVisitors,
    returningVisitors,
    returningVisitorRatePct: totalVisitors > 0 ? (returningVisitors / totalVisitors) * 100 : 0,

    conversionRatePct: totalSessions > 0 ? (convertedSessions / totalSessions) * 100 : 0,
    customerLifetimeValue: customerInsights.avgClv,
    repeatPurchaseRatePct: customerInsights.returningRate,

    refundRatePct: nonCancelledOrders > 0 ? (Number(rates.refundedOrders) / nonCancelledOrders) * 100 : 0,
    returnRatePct: nonCancelledOrders > 0 ? (Number(rates.returnedOrders) / nonCancelledOrders) * 100 : 0,
    cancelledRatePct: allOrders > 0 ? (Number(rates.cancelledOrders) / allOrders) * 100 : 0,

    inventoryValue,
    pendingPaymentsCount: Number(pending.count),
    pendingPaymentsAmount: pending.amount,
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

const INSIGHTS_CACHE_KEY = "bi:automated-insights";

export async function getAutomatedInsights(): Promise<AutomatedInsight[]> {
  const cached = await cacheGet<AutomatedInsight[]>(INSIGHTS_CACHE_KEY);
  if (cached) return cached;

  const [overview, lowStock, deadStock, bestSelling, customers] = await Promise.all([
    getExecutiveOverview(),
    getLowStockVariants(),
    getDeadStockReport(90, 5),
    getBestSellingPrediction(3),
    loadCustomersWithComputedFields({}),
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
      title: `৳${Math.round(deadStockValue).toLocaleString("en-BD")} tied up in dead stock`,
      detail: `${deadStock.length} variant(s) with stock on hand but zero sales in the last 90 days.`,
    });
  }

  if (overview.revenueGrowthPct <= -10) {
    insights.push({
      id: "revenue-decline",
      severity: "critical",
      title: `Revenue down ${Math.abs(overview.revenueGrowthPct).toFixed(1)}% this month`,
      detail: "Compared to last month, lifetime non-cancelled orders.",
    });
  } else if (overview.revenueGrowthPct >= 10) {
    insights.push({
      id: "revenue-growth",
      severity: "info",
      title: `Revenue up ${overview.revenueGrowthPct.toFixed(1)}% this month`,
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
      detail: "Based on recent sales velocity — see the prediction table below.",
    });
  }

  if (insights.length === 0) {
    insights.push({ id: "all-clear", severity: "info", title: "No automated alerts right now", detail: "Nothing has crossed a threshold yet." });
  }

  await cacheSet(INSIGHTS_CACHE_KEY, insights, 60);
  return insights;
}
