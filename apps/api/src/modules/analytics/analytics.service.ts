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

  const [revenueAgg, orderCount, prevRevenueAgg, prevOrderCount, pendingCount, lowStockCount] = await Promise.all([
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
  };
}

/** Records one anonymous pageview beacon — best-effort, never blocks the storefront. */
export async function trackPageView(input: TrackPageViewInput) {
  await prisma.pageView.create({
    data: {
      sessionId: input.sessionId,
      path: input.path,
      referrer: input.referrer ?? null,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
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

/** Carts currently sitting idle past the abandonment threshold, regardless of whether a recovery
 * email has already gone out — see cart.service.findAbandonedCarts for the recovery-cron's
 * (narrower) view of the same data. */
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
