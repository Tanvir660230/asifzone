import type { OrderStatus } from "@prisma/client";
import type { TrackPageViewInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { ABANDONMENT_THRESHOLD_MS } from "../cart/cart.service";

const CACHE_TTL_SECONDS = 300;
const NON_REVENUE_STATUSES: OrderStatus[] = ["CANCELLED"];

function daysAgo(days: number): Date {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

/** Daily order count + gross order value for the last N days, zero-filled so the chart has no gaps. */
export async function getRevenueSeries(days = 30) {
  const cacheKey = `analytics:revenue:${days}`;
  const cached = await cacheGet<Array<{ date: string; revenue: number; orders: number }>>(cacheKey);
  if (cached) return cached;

  // UTC throughout, so the day-keys generated here always match Postgres's UTC-based date_trunc,
  // regardless of the Node process's local timezone.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.$queryRaw<Array<{ day: Date; revenue: number; orders: bigint }>>`
    SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day,
           COALESCE(SUM(total), 0)::float AS revenue,
           COUNT(*)::bigint AS orders
    FROM "Order"
    WHERE "createdAt" >= ${since} AND status != 'CANCELLED'
    GROUP BY day
    ORDER BY day ASC
  `;

  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), { revenue: r.revenue, orders: Number(r.orders) }]));

  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const point = byDay.get(key);
    series.push({ date: key, revenue: point?.revenue ?? 0, orders: point?.orders ?? 0 });
  }

  await cacheSet(cacheKey, series, CACHE_TTL_SECONDS);
  return series;
}

export async function getOrderStatusCounts() {
  const cacheKey = "analytics:status-counts";
  const cached = await cacheGet<Array<{ status: string; count: number }>>(cacheKey);
  if (cached) return cached;

  const grouped = await prisma.order.groupBy({ by: ["status"], _count: { _all: true } });
  const result = grouped.map((g) => ({ status: g.status, count: g._count._all }));

  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

export async function getTopProducts(days = 30, limit = 5) {
  const cacheKey = `analytics:top-products:${days}:${limit}`;
  const cached = await cacheGet<Array<{ name: string; quantitySold: number; revenue: number }>>(cacheKey);
  if (cached) return cached;

  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await prisma.$queryRaw<Array<{ name: string; quantitySold: bigint; revenue: number }>>`
    SELECT oi."productNameSnapshot" AS name,
           SUM(oi.quantity)::bigint AS "quantitySold",
           SUM(oi.quantity * oi."priceSnapshot")::float AS revenue
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE o."createdAt" >= ${since} AND o.status != 'CANCELLED'
    GROUP BY oi."productNameSnapshot"
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ name: r.name, quantitySold: Number(r.quantitySold), revenue: r.revenue }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

export async function getLowStockVariants(threshold = 5, limit = 20) {
  return prisma.productVariant.findMany({
    where: { stock: { lte: threshold }, product: { isActive: true } },
    include: { product: { select: { name: true, slug: true } } },
    orderBy: { stock: "asc" },
    take: limit,
  });
}

export async function getDashboardSummary() {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const prevSince = new Date();
  prevSince.setDate(prevSince.getDate() - 60);

  const [revenueAgg, orderCount, prevRevenueAgg, prevOrderCount, pendingCount, lowStockCount, visitorRows, courierLossAgg] =
    await Promise.all([
      prisma.order.aggregate({
        where: { createdAt: { gte: since }, status: { notIn: NON_REVENUE_STATUSES } },
        _sum: { total: true },
      }),
      prisma.order.count({ where: { createdAt: { gte: since }, status: { notIn: NON_REVENUE_STATUSES } } }),
      // Prior 30-day window (day -60 to -30) — the baseline the dashboard's trend deltas compare against.
      prisma.order.aggregate({
        where: { createdAt: { gte: prevSince, lt: since }, status: { notIn: NON_REVENUE_STATUSES } },
        _sum: { total: true },
      }),
      prisma.order.count({ where: { createdAt: { gte: prevSince, lt: since }, status: { notIn: NON_REVENUE_STATUSES } } }),
      prisma.order.count({ where: { status: "PENDING" } }),
      prisma.productVariant.count({ where: { stock: { lte: 5 }, product: { isActive: true } } }),
      // Unique visitors = distinct sessionId, current vs. prior 30-day window (same FILTER pattern as
      // the revenue/order aggregates above).
      prisma.$queryRaw<Array<{ current: bigint; previous: bigint }>>`
      SELECT
        COUNT(DISTINCT "sessionId") FILTER (WHERE "createdAt" >= ${since})::bigint AS current,
        COUNT(DISTINCT "sessionId") FILTER (WHERE "createdAt" >= ${prevSince} AND "createdAt" < ${since})::bigint AS previous
      FROM "PageView"
      WHERE "createdAt" >= ${prevSince}
    `,
      // Estimated money lost to courier round trips (post-booking cancellations + partial-delivery
      // returns) — see CourierLossEvent in schema.prisma and order.service.ts's getCourierReturnFee.
      prisma.courierLossEvent.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

  const revenue30d = Number(revenueAgg._sum?.total ?? 0);
  const revenuePrev30d = Number(prevRevenueAgg._sum?.total ?? 0);

  return {
    revenue30d,
    orders30d: orderCount,
    revenuePrev30d,
    ordersPrev30d: prevOrderCount,
    pendingOrders: pendingCount,
    lowStockCount,
    aov30d: orderCount > 0 ? revenue30d / orderCount : 0,
    aovPrev30d: prevOrderCount > 0 ? revenuePrev30d / prevOrderCount : 0,
    uniqueVisitors30d: Number(visitorRows[0]?.current ?? 0),
    uniqueVisitorsPrev30d: Number(visitorRows[0]?.previous ?? 0),
    courierLoss30d: Number(courierLossAgg._sum?.amount ?? 0),
    courierLossCount30d: courierLossAgg._count,
  };
}

/** Daily unique-visitor + pageview counts for the last N days, zero-filled — the visitor-side
 * counterpart to getRevenueSeries. "Visitor" here means a distinct PageView.sessionId, the closest
 * this anonymous, cookie-based system gets to a person. */
export async function getVisitorSeries(days = 30) {
  const cacheKey = `analytics:visitors:${days}`;
  const cached = await cacheGet<Array<{ date: string; visitors: number; pageViews: number }>>(cacheKey);
  if (cached) return cached;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.$queryRaw<Array<{ day: Date; visitors: bigint; pageViews: bigint }>>`
    SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day,
           COUNT(DISTINCT "sessionId")::bigint AS visitors,
           COUNT(*)::bigint AS "pageViews"
    FROM "PageView"
    WHERE "createdAt" >= ${since}
    GROUP BY day
    ORDER BY day ASC
  `;

  const byDay = new Map(
    rows.map((r) => [r.day.toISOString().slice(0, 10), { visitors: Number(r.visitors), pageViews: Number(r.pageViews) }]),
  );

  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const point = byDay.get(key);
    series.push({ date: key, visitors: point?.visitors ?? 0, pageViews: point?.pageViews ?? 0 });
  }

  await cacheSet(cacheKey, series, CACHE_TTL_SECONDS);
  return series;
}

/** Records one anonymous pageview beacon — best-effort, never blocks the storefront. `userAgent`
 * is read server-side from the request header (see the controller), never from the client body —
 * the browser already sends it on every request, so trusting the header avoids giving a spoofable
 * field to the public beacon endpoint. */
export async function trackPageView(input: TrackPageViewInput, userAgent: string | null) {
  await prisma.pageView.create({
    data: {
      sessionId: input.sessionId,
      path: input.path,
      referrer: input.referrer ?? null,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      userAgent,
    },
  });
}

/** Product-page views ranked by count — the admin-facing counterpart to the per-product "N people
 * viewed today" urgency banner, which reads the same ProductViewLog table for a single product. */
export async function getMostViewedProducts(days = 30, limit = 10) {
  const cacheKey = `analytics:most-viewed:${days}:${limit}`;
  const cached = await cacheGet<Array<{ id: string; name: string; slug: string; views: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; views: bigint }>>`
    SELECT p.id, p.name, p.slug, COUNT(*)::bigint AS views
    FROM "ProductViewLog" v
    JOIN "Product" p ON p.id = v."productId"
    WHERE v."createdAt" >= ${since}
    GROUP BY p.id, p.name, p.slug
    ORDER BY views DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, views: Number(r.views) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Products whose view count is accelerating — this week's ProductViewLog rows vs. the week
 * before — the view-based counterpart to getBestSellingPrediction (which tracks sales velocity
 * instead of interest). Surfaces items gaining attention before that shows up in sales. */
export async function getTrendingProducts(limit = 10) {
  const cacheKey = `analytics:trending-products:${limit}`;
  const cached = await cacheGet<
    Array<{ id: string; name: string; slug: string; recentViews: number; priorViews: number; growthPct: number }>
  >(cacheKey);
  if (cached) return cached;

  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; slug: string; recentViews: bigint; priorViews: bigint }>
  >`
    WITH recent AS (
      SELECT "productId", COUNT(*)::bigint AS views
      FROM "ProductViewLog"
      WHERE "createdAt" >= NOW() - INTERVAL '7 days'
      GROUP BY "productId"
    ),
    prior AS (
      SELECT "productId", COUNT(*)::bigint AS views
      FROM "ProductViewLog"
      WHERE "createdAt" >= NOW() - INTERVAL '14 days' AND "createdAt" < NOW() - INTERVAL '7 days'
      GROUP BY "productId"
    )
    SELECT p.id, p.name, p.slug, r.views AS "recentViews", COALESCE(pr.views, 0) AS "priorViews"
    FROM recent r
    JOIN "Product" p ON p.id = r."productId"
    LEFT JOIN prior pr ON pr."productId" = r."productId"
    ORDER BY (r.views - COALESCE(pr.views, 0)) DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => {
    const recentViews = Number(r.recentViews);
    const priorViews = Number(r.priorViews);
    const growthPct = priorViews > 0 ? ((recentViews - priorViews) / priorViews) * 100 : recentViews > 0 ? 100 : 0;
    return { id: r.id, name: r.name, slug: r.slug, recentViews, priorViews, growthPct };
  });
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Top search queries plus the store-wide zero-result rate (a high rate usually means catalog gaps
 * or synonym misses, not that visitors aren't searching). */
export async function getSearchAnalytics(days = 30, limit = 10) {
  const cacheKey = `analytics:search:${days}:${limit}`;
  const cached = await cacheGet<{
    topQueries: Array<{ query: string; count: number }>;
    totalSearches: number;
    zeroResultSearches: number;
    zeroResultRate: number;
  }>(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const [topQueries, totals] = await Promise.all([
    prisma.$queryRaw<Array<{ query: string; count: bigint }>>`
      SELECT query, COUNT(*)::bigint AS count
      FROM "SearchLog"
      WHERE "createdAt" >= ${since}
      GROUP BY query
      ORDER BY count DESC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Array<{ total: bigint; zeroResult: bigint }>>`
      SELECT COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE "resultCount" = 0)::bigint AS "zeroResult"
      FROM "SearchLog"
      WHERE "createdAt" >= ${since}
    `,
  ]);

  const total = Number(totals[0]?.total ?? 0);
  const zeroResult = Number(totals[0]?.zeroResult ?? 0);

  const result = {
    topQueries: topQueries.map((r) => ({ query: r.query, count: Number(r.count) })),
    totalSearches: total,
    zeroResultSearches: zeroResult,
    zeroResultRate: total > 0 ? (zeroResult / total) * 100 : 0,
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Carts currently sitting idle past the abandonment threshold. */
export async function getCartAbandonmentSummary() {
  const cacheKey = "analytics:cart-abandonment";
  const cached = await cacheGet<{ cartCount: number; potentialRevenue: number }>(cacheKey);
  if (cached) return cached;

  const cutoff = new Date(Date.now() - ABANDONMENT_THRESHOLD_MS);
  const rows = await prisma.$queryRaw<Array<{ cartCount: bigint; potentialRevenue: number }>>`
    SELECT COUNT(DISTINCT c.id)::bigint AS "cartCount",
           COALESCE(SUM(ci.quantity * COALESCE(pv.price, p."basePrice")), 0)::float AS "potentialRevenue"
    FROM "Cart" c
    JOIN "CartItem" ci ON ci."cartId" = c.id
    JOIN "ProductVariant" pv ON pv.id = ci."variantId"
    JOIN "Product" p ON p.id = pv."productId"
    WHERE c."updatedAt" <= ${cutoff}
  `;

  const result = {
    cartCount: Number(rows[0]?.cartCount ?? 0),
    potentialRevenue: rows[0]?.potentialRevenue ?? 0,
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Store-wide returning-customer rate and average customer lifetime value, computed over every
 * customer with at least one non-cancelled order (all-time, not windowed by `days`). */
export async function getCustomerInsights() {
  const cacheKey = "analytics:customer-insights";
  const cached = await cacheGet<{ totalCustomers: number; returningCustomers: number; returningRate: number; avgClv: number }>(
    cacheKey,
  );
  if (cached) return cached;

  const rows = await prisma.$queryRaw<Array<{ totalCustomers: bigint; returningCustomers: bigint; avgClv: number }>>`
    WITH per_customer AS (
      SELECT o."customerId" AS cid, COUNT(*) AS cnt, SUM(o.total) AS spend
      FROM "Order" o
      WHERE o."customerId" IS NOT NULL AND o.status != 'CANCELLED'
      GROUP BY o."customerId"
    )
    SELECT COUNT(*)::bigint AS "totalCustomers",
           COUNT(*) FILTER (WHERE cnt > 1)::bigint AS "returningCustomers",
           COALESCE(AVG(spend), 0)::float AS "avgClv"
    FROM per_customer
  `;

  const totalCustomers = Number(rows[0]?.totalCustomers ?? 0);
  const returningCustomers = Number(rows[0]?.returningCustomers ?? 0);

  const result = {
    totalCustomers,
    returningCustomers,
    returningRate: totalCustomers > 0 ? (returningCustomers / totalCustomers) * 100 : 0,
    avgClv: rows[0]?.avgClv ?? 0,
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** New-customer cohorts by first-order month, and what fraction of each cohort placed another
 * order in each subsequent month — the standard cohort-retention grid. Cancelled orders don't
 * count toward "first order" or "active", so a cancelled/refunded order can't manufacture a false
 * first touch. Covers the last 6 cohort months, up to 5 months of retention each. */
export async function getCohortRetention() {
  const cacheKey = "analytics:cohort-retention";
  const cached = await cacheGet<
    Array<{ cohortMonth: string; cohortSize: number; retention: Array<{ monthOffset: number; activeCustomers: number; retentionPct: number }> }>
  >(cacheKey);
  if (cached) return cached;

  const since = new Date();
  since.setMonth(since.getMonth() - 5);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const rows = await prisma.$queryRaw<Array<{ cohortMonth: Date; monthOffset: number; activeCustomers: bigint }>>`
    WITH first_order AS (
      SELECT "customerId", date_trunc('month', MIN("createdAt")) AS cohort_month
      FROM "Order"
      WHERE "customerId" IS NOT NULL AND status != 'CANCELLED'
      GROUP BY "customerId"
    ),
    activity AS (
      SELECT DISTINCT "customerId", date_trunc('month', "createdAt") AS active_month
      FROM "Order"
      WHERE "customerId" IS NOT NULL AND status != 'CANCELLED'
    )
    SELECT
      fo.cohort_month AS "cohortMonth",
      (
        (EXTRACT(YEAR FROM a.active_month) - EXTRACT(YEAR FROM fo.cohort_month)) * 12
        + (EXTRACT(MONTH FROM a.active_month) - EXTRACT(MONTH FROM fo.cohort_month))
      )::int AS "monthOffset",
      COUNT(DISTINCT a."customerId")::bigint AS "activeCustomers"
    FROM first_order fo
    JOIN activity a ON a."customerId" = fo."customerId" AND a.active_month >= fo.cohort_month
    WHERE fo.cohort_month >= ${since}
    GROUP BY fo.cohort_month, "monthOffset"
    ORDER BY fo.cohort_month ASC, "monthOffset" ASC
  `;

  const byCohort = new Map<string, { cohortSize: number; points: Map<number, number> }>();
  for (const r of rows) {
    const key = r.cohortMonth.toISOString().slice(0, 10);
    const entry = byCohort.get(key) ?? { cohortSize: 0, points: new Map<number, number>() };
    const active = Number(r.activeCustomers);
    if (r.monthOffset === 0) entry.cohortSize = active;
    entry.points.set(r.monthOffset, active);
    byCohort.set(key, entry);
  }

  const now = new Date();
  const result = Array.from(byCohort.entries()).map(([cohortMonth, { cohortSize, points }]) => {
    const cohortDate = new Date(cohortMonth);
    const monthsElapsed = (now.getFullYear() - cohortDate.getFullYear()) * 12 + (now.getMonth() - cohortDate.getMonth());
    const maxOffset = Math.min(5, monthsElapsed);
    const retention = [];
    for (let offset = 0; offset <= maxOffset; offset++) {
      const activeCustomers = points.get(offset) ?? 0;
      retention.push({ monthOffset: offset, activeCustomers, retentionPct: cohortSize > 0 ? (activeCustomers / cohortSize) * 100 : 0 });
    }
    return { cohortMonth, cohortSize, retention };
  });

  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

export async function getTopCategories(days = 30, limit = 10) {
  const cacheKey = `analytics:top-categories:${days}:${limit}`;
  const cached = await cacheGet<Array<{ name: string; quantitySold: number; revenue: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<Array<{ name: string; quantitySold: bigint; revenue: number }>>`
    SELECT c.name AS name,
           SUM(oi.quantity)::bigint AS "quantitySold",
           SUM(oi.quantity * oi."priceSnapshot")::float AS revenue
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    JOIN "ProductVariant" pv ON pv.id = oi."variantId"
    JOIN "Product" p ON p.id = pv."productId"
    JOIN "Category" c ON c.id = p."categoryId"
    WHERE o."createdAt" >= ${since} AND o.status != 'CANCELLED'
    GROUP BY c.id, c.name
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ name: r.name, quantitySold: Number(r.quantitySold), revenue: r.revenue }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

export async function getTopBrands(days = 30, limit = 10) {
  const cacheKey = `analytics:top-brands:${days}:${limit}`;
  const cached = await cacheGet<Array<{ name: string; quantitySold: number; revenue: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<Array<{ name: string; quantitySold: bigint; revenue: number }>>`
    SELECT COALESCE(p.brand, 'Unbranded') AS name,
           SUM(oi.quantity)::bigint AS "quantitySold",
           SUM(oi.quantity * oi."priceSnapshot")::float AS revenue
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    JOIN "ProductVariant" pv ON pv.id = oi."variantId"
    JOIN "Product" p ON p.id = pv."productId"
    WHERE o."createdAt" >= ${since} AND o.status != 'CANCELLED'
    GROUP BY COALESCE(p.brand, 'Unbranded')
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ name: r.name, quantitySold: Number(r.quantitySold), revenue: r.revenue }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Conversion rate = sessions that placed an order ÷ total sessions; bounce rate = sessions with
 * exactly one pageview ÷ total sessions. Both require the PageView beacon to actually be firing —
 * return zeros (not an error) when there's no pageview data yet for the window. */
export async function getConversionFunnel(days = 30) {
  const cacheKey = `analytics:funnel:${days}`;
  const cached = await cacheGet<{ totalSessions: number; bouncedSessions: number; convertedSessions: number; conversionRate: number; bounceRate: number }>(
    cacheKey,
  );
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<Array<{ totalSessions: bigint; bouncedSessions: bigint; convertedSessions: bigint }>>`
    WITH sessions AS (
      SELECT "sessionId", COUNT(*) AS views
      FROM "PageView"
      WHERE "createdAt" >= ${since}
      GROUP BY "sessionId"
    ),
    converted AS (
      SELECT DISTINCT "sessionId"
      FROM "Order"
      WHERE "sessionId" IS NOT NULL AND "createdAt" >= ${since} AND status != 'CANCELLED'
    )
    SELECT
      (SELECT COUNT(*) FROM sessions)::bigint AS "totalSessions",
      (SELECT COUNT(*) FROM sessions WHERE views = 1)::bigint AS "bouncedSessions",
      (SELECT COUNT(*) FROM converted)::bigint AS "convertedSessions"
  `;

  const totalSessions = Number(rows[0]?.totalSessions ?? 0);
  const bouncedSessions = Number(rows[0]?.bouncedSessions ?? 0);
  const convertedSessions = Number(rows[0]?.convertedSessions ?? 0);

  const result = {
    totalSessions,
    bouncedSessions,
    convertedSessions,
    conversionRate: totalSessions > 0 ? (convertedSessions / totalSessions) * 100 : 0,
    bounceRate: totalSessions > 0 ? (bouncedSessions / totalSessions) * 100 : 0,
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Sessions grouped by first-touch source: an explicit utm_source if present, else the referring
 * site's domain, else "Direct" (no referrer — typed URL, bookmark, or an app with no referrer). */
export async function getTrafficSources(days = 30, limit = 10) {
  const cacheKey = `analytics:traffic-sources:${days}:${limit}`;
  const cached = await cacheGet<Array<{ source: string; sessions: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<Array<{ source: string; sessions: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", referrer, "utmSource"
      FROM "PageView"
      WHERE "createdAt" >= ${since}
      ORDER BY "sessionId", "createdAt" ASC
    )
    SELECT
      CASE
        WHEN "utmSource" IS NOT NULL THEN "utmSource"
        WHEN referrer IS NULL OR referrer = '' THEN 'Direct'
        ELSE regexp_replace(regexp_replace(referrer, '^https?://(www\.)?', ''), '/.*$', '')
      END AS source,
      COUNT(*)::bigint AS sessions
    FROM first_touch
    GROUP BY source
    ORDER BY sessions DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ source: r.source, sessions: Number(r.sessions) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Active products with stock on hand but little or no recent sales — candidates for a markdown,
 * bundle, or featured placement before they tie up capital indefinitely. */
export async function getSlowMovingProducts(days = 30, limit = 10) {
  const cacheKey = `analytics:slow-moving:${days}:${limit}`;
  const cached = await cacheGet<Array<{ id: string; name: string; slug: string; unitsSold: number; totalStock: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; unitsSold: bigint; totalStock: bigint }>>`
    SELECT p.id, p.name, p.slug,
           COALESCE(sold.qty, 0)::bigint AS "unitsSold",
           COALESCE(stock.total, 0)::bigint AS "totalStock"
    FROM "Product" p
    LEFT JOIN LATERAL (
      SELECT SUM(oi.quantity) AS qty
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "ProductVariant" pv ON pv.id = oi."variantId"
      WHERE pv."productId" = p.id AND o."createdAt" >= ${since} AND o.status != 'CANCELLED'
    ) sold ON true
    LEFT JOIN LATERAL (
      SELECT SUM(stock) AS total FROM "ProductVariant" WHERE "productId" = p.id
    ) stock ON true
    WHERE p."isActive" = true AND p."deletedAt" IS NULL AND COALESCE(stock.total, 0) > 0
    ORDER BY "unitsSold" ASC, "totalStock" DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    unitsSold: Number(r.unitsSold),
    totalStock: Number(r.totalStock),
  }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Products whose sales velocity is accelerating — this week's units sold vs. the week before —
 * ranked by growth. A simple trend signal, not a statistical forecast model. */
export async function getBestSellingPrediction(limit = 10) {
  const cacheKey = `analytics:best-selling-prediction:${limit}`;
  const cached = await cacheGet<Array<{ name: string; recentUnits: number; priorUnits: number; growthPct: number }>>(cacheKey);
  if (cached) return cached;

  const rows = await prisma.$queryRaw<Array<{ name: string; recentUnits: bigint; priorUnits: bigint }>>`
    WITH recent AS (
      SELECT oi."productNameSnapshot" AS name, SUM(oi.quantity) AS qty
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o."createdAt" >= NOW() - INTERVAL '7 days' AND o.status != 'CANCELLED'
      GROUP BY oi."productNameSnapshot"
    ),
    prior AS (
      SELECT oi."productNameSnapshot" AS name, SUM(oi.quantity) AS qty
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o."createdAt" >= NOW() - INTERVAL '14 days' AND o."createdAt" < NOW() - INTERVAL '7 days' AND o.status != 'CANCELLED'
      GROUP BY oi."productNameSnapshot"
    )
    SELECT r.name, r.qty AS "recentUnits", COALESCE(p.qty, 0) AS "priorUnits"
    FROM recent r
    LEFT JOIN prior p ON p.name = r.name
    ORDER BY (r.qty - COALESCE(p.qty, 0)) DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => {
    const recentUnits = Number(r.recentUnits);
    const priorUnits = Number(r.priorUnits);
    const growthPct = priorUnits > 0 ? ((recentUnits - priorUnits) / priorUnits) * 100 : recentUnits > 0 ? 100 : 0;
    return { name: r.name, recentUnits, priorUnits, growthPct };
  });
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Variants projected to sell out soonest, from recent daily sales velocity — ranked by estimated
 * days of stock remaining. Only includes variants that have actually been selling (velocity > 0). */
export async function getDemandForecast(days = 14, limit = 10) {
  const cacheKey = `analytics:demand-forecast:${days}:${limit}`;
  const cached = await cacheGet<
    Array<{ variantId: string; productName: string; sku: string; stock: number; dailyVelocity: number; projected7d: number; daysUntilStockout: number }>
  >(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<Array<{ variantId: string; productName: string; sku: string; stock: number; unitsSold: bigint }>>`
    SELECT pv.id AS "variantId", p.name AS "productName", pv.sku, pv.stock,
           SUM(oi.quantity)::bigint AS "unitsSold"
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    JOIN "ProductVariant" pv ON pv.id = oi."variantId"
    JOIN "Product" p ON p.id = pv."productId"
    WHERE o."createdAt" >= ${since} AND o.status != 'CANCELLED' AND p."isActive" = true AND pv.stock > 0
    GROUP BY pv.id, p.name, pv.sku, pv.stock
    HAVING SUM(oi.quantity) > 0
  `;

  const result = rows
    .map((r) => {
      const unitsSold = Number(r.unitsSold);
      const dailyVelocity = unitsSold / days;
      return {
        variantId: r.variantId,
        productName: r.productName,
        sku: r.sku,
        stock: r.stock,
        dailyVelocity,
        projected7d: dailyVelocity * 7,
        daysUntilStockout: dailyVelocity > 0 ? r.stock / dailyVelocity : Infinity,
      };
    })
    .sort((a, b) => a.daysUntilStockout - b.daysUntilStockout)
    .slice(0, limit);

  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Sessions active in the last N minutes — deliberately uncached (or cached only briefly) since
 * "how many people are on the site right now" is only useful if it's actually current. */
export async function getActiveVisitorCount(windowMinutes = 5) {
  const cacheKey = `analytics:active-visitors:${windowMinutes}`;
  const cached = await cacheGet<number>(cacheKey);
  if (cached !== null) return cached;

  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT "sessionId")::bigint AS count
    FROM "PageView"
    WHERE "createdAt" >= ${since}
  `;

  const result = Number(rows[0]?.count ?? 0);
  await cacheSet(cacheKey, result, 15);
  return result;
}

/** Pageview counts bucketed by day-of-week × hour-of-day, in Bangladesh local time (this store's
 * market) rather than UTC — "9pm is the busiest hour" is only actionable in wall-clock time.
 * Zero-filled across all 7×24 = 168 cells so the heatmap has no gaps. */
export async function getTrafficHeatmap(days = 30) {
  const cacheKey = `analytics:traffic-heatmap:${days}`;
  const cached = await cacheGet<Array<{ dow: number; hour: number; count: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<Array<{ dow: number; hour: number; count: bigint }>>`
    SELECT
      EXTRACT(DOW FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')::int AS dow,
      EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')::int AS hour,
      COUNT(*)::bigint AS count
    FROM "PageView"
    WHERE "createdAt" >= ${since}
    GROUP BY dow, hour
  `;

  const byCell = new Map(rows.map((r) => [`${r.dow}:${r.hour}`, Number(r.count)]));
  const result = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      result.push({ dow, hour, count: byCell.get(`${dow}:${hour}`) ?? 0 });
    }
  }

  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Sessions grouped by coarse device class, sniffed from the pageview beacon's User-Agent header.
 * Deliberately simple substring/regex matching (no UA-parsing library) — good enough for a
 * mobile-vs-desktop split, not meant to identify exact devices. */
export async function getDeviceBreakdown(days = 30) {
  const cacheKey = `analytics:devices:${days}`;
  const cached = await cacheGet<Array<{ device: string; sessions: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<Array<{ device: string; sessions: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", "userAgent"
      FROM "PageView"
      WHERE "createdAt" >= ${since}
      ORDER BY "sessionId", "createdAt" ASC
    )
    SELECT
      CASE
        WHEN "userAgent" IS NULL THEN 'Unknown'
        WHEN "userAgent" ~* 'iPad|Tablet' THEN 'Tablet'
        WHEN "userAgent" ~* 'Mobi|Android|iPhone' THEN 'Mobile'
        ELSE 'Desktop'
      END AS device,
      COUNT(*)::bigint AS sessions
    FROM first_touch
    GROUP BY device
    ORDER BY sessions DESC
  `;

  const result = rows.map((r) => ({ device: r.device, sessions: Number(r.sessions) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Sessions grouped by browser family, sniffed from the same User-Agent header as
 * getDeviceBreakdown. Match order matters — Edge/Opera UAs also contain "Chrome/", and
 * Chrome/Edge/Opera UAs all contain "Safari/", so the more specific tokens are checked first. */
export async function getBrowserBreakdown(days = 30) {
  const cacheKey = `analytics:browsers:${days}`;
  const cached = await cacheGet<Array<{ browser: string; sessions: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<Array<{ browser: string; sessions: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", "userAgent"
      FROM "PageView"
      WHERE "createdAt" >= ${since}
      ORDER BY "sessionId", "createdAt" ASC
    )
    SELECT
      CASE
        WHEN "userAgent" IS NULL THEN 'Unknown'
        WHEN "userAgent" ~* 'Edg/' THEN 'Edge'
        WHEN "userAgent" ~* 'OPR/|Opera' THEN 'Opera'
        WHEN "userAgent" ~* 'Chrome/' THEN 'Chrome'
        WHEN "userAgent" ~* 'Firefox/' THEN 'Firefox'
        WHEN "userAgent" ~* 'Safari/' THEN 'Safari'
        ELSE 'Other'
      END AS browser,
      COUNT(*)::bigint AS sessions
    FROM first_touch
    GROUP BY browser
    ORDER BY sessions DESC
  `;

  const result = rows.map((r) => ({ browser: r.browser, sessions: Number(r.sessions) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Revenue/order count attributed to each `utm_campaign`, via the session that placed the order —
 * only sessions that arrived with a campaign tag are counted, so organic/direct traffic (the
 * majority) never shows up here. */
export async function getCampaignPerformance(days = 30, limit = 10) {
  const cacheKey = `analytics:campaigns:${days}:${limit}`;
  const cached = await cacheGet<Array<{ campaign: string; orders: number; revenue: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<Array<{ campaign: string; orders: bigint; revenue: number }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", "utmCampaign"
      FROM "PageView"
      WHERE "utmCampaign" IS NOT NULL AND "createdAt" >= ${since}
      ORDER BY "sessionId", "createdAt" ASC
    )
    SELECT ft."utmCampaign" AS campaign,
           COUNT(o.id)::bigint AS orders,
           COALESCE(SUM(o.total), 0)::float AS revenue
    FROM first_touch ft
    JOIN "Order" o ON o."sessionId" = ft."sessionId" AND o.status != 'CANCELLED' AND o."createdAt" >= ${since}
    GROUP BY ft."utmCampaign"
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ campaign: r.campaign, orders: Number(r.orders), revenue: r.revenue }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}
