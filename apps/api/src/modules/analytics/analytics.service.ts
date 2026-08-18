import { Prisma, type OrderStatus } from "@prisma/client";
import geoip from "geoip-lite";
import type { TrackPageViewInput, TrackPageExitInput, TrackFunnelEventInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { ABANDONMENT_THRESHOLD_MS } from "../cart/cart.service";
import { loadCustomersWithComputedFields } from "../customers/customer.service";
import { getSettings } from "../settings/settings.service";

const CACHE_TTL_SECONDS = 300;
const NON_REVENUE_STATUSES: OrderStatus[] = ["CANCELLED"];

function daysAgo(days: number): Date {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

/** Optional lookback window shared by every "windowed" read below — `undefined` means lifetime
 * (no lower bound at all), the "All" option in the days range selector on /admin/bi/visitors. */
function daysAgoOrUndefined(days: number | undefined): Date | undefined {
  return days === undefined ? undefined : daysAgo(days);
}

/** Best-effort geoip-lite lookup off the request IP — offline/free database, so misses (private/
 * local IPs, addresses outside its coverage) are expected and just mean null geo fields, not an
 * error. IPv4-mapped IPv6 addresses (the common shape of req.ip behind a proxy) are handled by
 * geoip-lite itself. */
function lookupGeo(ip: string | null): { countryCode: string | null; region: string | null; city: string | null } {
  if (!ip) return { countryCode: null, region: null, city: null };
  const geo = geoip.lookup(ip);
  if (!geo) return { countryCode: null, region: null, city: null };
  return { countryCode: geo.country || null, region: geo.region || null, city: geo.city || null };
}

/** First tag of the Accept-Language header (e.g. "en-US,en;q=0.9" -> "en-US") — good enough for a
 * language breakdown without pulling in a full header-parsing library. */
function primaryLanguage(acceptLanguage: string | null): string | null {
  if (!acceptLanguage) return null;
  const first = acceptLanguage.split(",")[0]?.trim().split(";")[0]?.trim();
  return first || null;
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
  const cached =
    await cacheGet<Array<{ name: string; quantitySold: number; revenue: number; productId: string | null; imageUrl: string | null }>>(
      cacheKey,
    );
  if (cached) return cached;

  const since = new Date();
  since.setDate(since.getDate() - days);

  // OrderItem deliberately snapshots name/sku/price instead of foreign-keying the live Product —
  // history has to stay accurate even after a product is renamed or deleted. `variantId` is still
  // a real column though (just not a Prisma relation), so it's usable here to resolve a *current*
  // thumbnail for products that are still live — grouped separately below, not joined into the
  // aggregate query, since ProductImage is one-to-many and would multiply the SUM() rows.
  const rows = await prisma.$queryRaw<Array<{ name: string; quantitySold: bigint; revenue: number; productId: string | null }>>`
    SELECT oi."productNameSnapshot" AS name,
           SUM(oi.quantity)::bigint AS "quantitySold",
           SUM(oi.quantity * oi."priceSnapshot")::float AS revenue,
           (ARRAY_AGG(pv."productId") FILTER (WHERE pv."productId" IS NOT NULL))[1] AS "productId"
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    LEFT JOIN "ProductVariant" pv ON pv.id = oi."variantId"
    WHERE o."createdAt" >= ${since} AND o.status != 'CANCELLED'
    GROUP BY oi."productNameSnapshot"
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  const productIds = rows.map((r) => r.productId).filter((id): id is string => Boolean(id));
  const images = productIds.length
    ? await prisma.productImage.findMany({
        where: { productId: { in: productIds } },
        orderBy: { sortOrder: "asc" },
        select: { productId: true, url: true },
      })
    : [];
  const imageByProduct = new Map<string, string>();
  for (const img of images) if (!imageByProduct.has(img.productId)) imageByProduct.set(img.productId, img.url);

  const result = rows.map((r) => ({
    name: r.name,
    quantitySold: Number(r.quantitySold),
    revenue: r.revenue,
    productId: r.productId,
    imageUrl: r.productId ? (imageByProduct.get(r.productId) ?? null) : null,
  }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

export async function getLowStockVariants(threshold = 5, limit = 20) {
  return prisma.productVariant.findMany({
    where: { stock: { lte: threshold }, product: { isActive: true } },
    include: {
      // `image` is this variant's own photo (e.g. the black colorway shot); falls back to the
      // product's first gallery image when the variant has none of its own.
      image: { select: { url: true } },
      product: { select: { id: true, name: true, slug: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } } },
    },
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

/** Records one anonymous pageview beacon — best-effort, never blocks the storefront. `userAgent`,
 * `ip`, `acceptLanguage`, and `isLoggedIn` are all read server-side (see the controller), never
 * from the client body — trusting these avoids handing spoofable fields to a public endpoint.
 * Returns the new row's id so the client can attach a later "exit" beacon to it. */
export async function trackPageView(
  input: TrackPageViewInput,
  userAgent: string | null,
  ip: string | null,
  acceptLanguage: string | null,
  isLoggedIn: boolean,
): Promise<string> {
  const geo = lookupGeo(ip);
  const row = await prisma.pageView.create({
    data: {
      sessionId: input.sessionId,
      visitorId: input.visitorId ?? null,
      path: input.path,
      referrer: input.referrer ?? null,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      userAgent,
      isLoggedIn,
      language: primaryLanguage(acceptLanguage),
      countryCode: geo.countryCode,
      region: geo.region,
      city: geo.city,
    },
    select: { id: true },
  });
  return row.id;
}

/** Fills in the engagement fields a pageview only knows once the visitor has left it — sent via
 * navigator.sendBeacon on route change / tab close. Best-effort: an unknown id (beacon arrived
 * for a row that's since aged out, or a stale/replayed id) is swallowed, never surfaced as an
 * error to the anonymous caller. */
export async function trackPageExit(id: string, input: TrackPageExitInput): Promise<void> {
  try {
    await prisma.pageView.update({
      where: { id },
      data: { durationMs: input.durationMs, scrollDepthPct: input.scrollDepthPct, clickCount: input.clickCount },
    });
  } catch {
    // unknown id — nothing to update, not worth failing the beacon over
  }
}

/** Records one purchase-funnel event (variant selection or add-to-cart) — the two Section-3
 * journey steps with no other trace anywhere in the schema (see FunnelEvent in schema.prisma).
 * Best-effort, same trust model as trackPageView. */
export async function trackFunnelEvent(input: TrackFunnelEventInput): Promise<void> {
  await prisma.funnelEvent.create({
    data: {
      sessionId: input.sessionId,
      visitorId: input.visitorId ?? null,
      type: input.type,
      productId: input.productId ?? null,
      variantId: input.variantId ?? null,
      path: input.path ?? null,
    },
  });
}

/** Best-effort correlation, not a lookup by id — `logSearch` (product.service.ts) creates a
 * SearchLog row with no session id (it never receives `req`), so this beacon, fired once the
 * search-results page has actually rendered, attaches one after the fact: the newest still-
 * unattributed row for this exact normalized query text within the last 2 minutes. Small,
 * accepted false-positive risk if two different sessions search the identical term in that
 * window — fine for an analytics breakdown, not for anything that gates behavior. Silently
 * no-ops when nothing matches, same tolerance as trackPageExit's unknown-id case. */
export async function attributeSearchSession(sessionId: string, visitorId: string | null, query: string): Promise<void> {
  try {
    const normalized = query.trim().toLowerCase();
    const since = new Date(Date.now() - 2 * 60 * 1000);
    const candidate = await prisma.searchLog.findFirst({
      where: { query: normalized, sessionId: null, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!candidate) return;
    await prisma.searchLog.update({ where: { id: candidate.id }, data: { sessionId, visitorId } });
  } catch {
    // best-effort correlation only
  }
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

/** Queries whose search volume is accelerating — this week vs. the week before — same
 * recent-vs-prior-7-day shape as getTrendingProducts, just over SearchLog instead of
 * ProductViewLog. */
export async function getSearchTrends(limit = 10) {
  const cacheKey = `analytics:search-trends:${limit}`;
  const cached = await cacheGet<Array<{ query: string; recentCount: number; priorCount: number; growthPct: number }>>(cacheKey);
  if (cached) return cached;

  const rows = await prisma.$queryRaw<Array<{ query: string; recentCount: bigint; priorCount: bigint }>>`
    WITH recent AS (
      SELECT query, COUNT(*)::bigint AS count
      FROM "SearchLog"
      WHERE "createdAt" >= NOW() - INTERVAL '7 days'
      GROUP BY query
    ),
    prior AS (
      SELECT query, COUNT(*)::bigint AS count
      FROM "SearchLog"
      WHERE "createdAt" >= NOW() - INTERVAL '14 days' AND "createdAt" < NOW() - INTERVAL '7 days'
      GROUP BY query
    )
    SELECT r.query, r.count AS "recentCount", COALESCE(p.count, 0) AS "priorCount"
    FROM recent r
    LEFT JOIN prior p ON p.query = r.query
    ORDER BY (r.count - COALESCE(p.count, 0)) DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => {
    const recentCount = Number(r.recentCount);
    const priorCount = Number(r.priorCount);
    const growthPct = priorCount > 0 ? ((recentCount - priorCount) / priorCount) * 100 : recentCount > 0 ? 100 : 0;
    return { query: r.query, recentCount, priorCount, growthPct };
  });
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Zero-result queries, grouped, with the catalog suggestion already shown for each (see
 * `suggestion` on SearchLog) — serves "no-result searches", "misspelled searches", and
 * "zero-result keyword suggestions" from the same underlying rows viewed once, since they're the
 * same data: a query nobody's catalog matched, and what the trigram/vocabulary lookup guessed
 * they meant. `suggestion` is null when the lookup found nothing plausible to suggest. */
export async function getNoResultSearches(days?: number, limit = 20) {
  const cacheKey = `analytics:no-result-searches:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<Array<{ query: string; count: number; lastSearchedAt: string; suggestion: string | null }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ query: string; count: bigint; lastSearchedAt: Date; suggestion: string | null }>>`
    SELECT
      query,
      COUNT(*)::bigint AS count,
      MAX("createdAt") AS "lastSearchedAt",
      (array_agg("suggestion") FILTER (WHERE "suggestion" IS NOT NULL))[1] AS suggestion
    FROM "SearchLog"
    WHERE "resultCount" = 0 AND "createdAt" >= ${since}
    GROUP BY query
    ORDER BY count DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({
    query: r.query,
    count: Number(r.count),
    lastSearchedAt: r.lastSearchedAt.toISOString(),
    suggestion: r.suggestion,
  }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Of sessions whose search got correlated (see attributeSearchSession — only a subset until that
 * beacon has had time to roll out): how many went on to place a real order vs. whose last
 * recorded pageview was the search results page itself (searched, then left). Excludes
 * uncorrelated SearchLog rows entirely rather than guessing, so this undercounts total search
 * volume by design — it's a rate over the sessions it can actually see, not an estimate over all
 * of them. */
export async function getSearchConversion(days?: number) {
  const cacheKey = `analytics:search-conversion:${days ?? "all"}`;
  const cached = await cacheGet<{ searchSessions: number; purchasedSessions: number; exitedSessions: number; purchaseRatePct: number; exitRatePct: number }>(
    cacheKey,
  );
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ searchSessions: bigint; purchasedSessions: bigint; exitedSessions: bigint }>>`
    WITH searched_sessions AS (
      SELECT DISTINCT "sessionId" FROM "SearchLog" WHERE "sessionId" IS NOT NULL AND "createdAt" >= ${since}
    ),
    converted AS (
      SELECT DISTINCT o."sessionId"
      FROM "Order" o
      JOIN searched_sessions s ON s."sessionId" = o."sessionId"
      WHERE o.status != 'CANCELLED'
    ),
    last_touch AS (
      SELECT DISTINCT ON (pv."sessionId") pv."sessionId", pv.path
      FROM "PageView" pv
      JOIN searched_sessions s ON s."sessionId" = pv."sessionId"
      ORDER BY pv."sessionId", pv."createdAt" DESC
    )
    SELECT
      (SELECT COUNT(*) FROM searched_sessions)::bigint AS "searchSessions",
      (SELECT COUNT(*) FROM converted)::bigint AS "purchasedSessions",
      (SELECT COUNT(*) FROM last_touch WHERE path LIKE '/search%')::bigint AS "exitedSessions"
  `;

  const r = rows[0]!;
  const searchSessions = Number(r.searchSessions);
  const purchasedSessions = Number(r.purchasedSessions);
  const exitedSessions = Number(r.exitedSessions);

  const result = {
    searchSessions,
    purchasedSessions,
    exitedSessions,
    purchaseRatePct: searchSessions > 0 ? (purchasedSessions / searchSessions) * 100 : 0,
    exitRatePct: searchSessions > 0 ? (exitedSessions / searchSessions) * 100 : 0,
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Device and guest-vs-logged-in breakdown of correlated search sessions — joins to PageView's
 * first-touch-per-session data (same device-regex convention as getDeviceBreakdown) rather than
 * capturing a second copy on SearchLog itself. Only covers correlated sessions, same caveat as
 * getSearchConversion. */
export async function getSearchAudience(days?: number) {
  const cacheKey = `analytics:search-audience:${days ?? "all"}`;
  const cached = await cacheGet<{
    devices: Array<{ device: string; sessions: number }>;
    loggedIn: number;
    guest: number;
  }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ device: string; sessions: bigint }>>`
    WITH search_sessions AS (
      SELECT DISTINCT "sessionId" FROM "SearchLog" WHERE "sessionId" IS NOT NULL AND "createdAt" >= ${since}
    ),
    first_touch AS (
      SELECT DISTINCT ON (pv."sessionId") pv."sessionId", pv."userAgent", pv."isLoggedIn"
      FROM "PageView" pv
      JOIN search_sessions s ON s."sessionId" = pv."sessionId"
      ORDER BY pv."sessionId", pv."createdAt" ASC
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

  const loggedInRows = await prisma.$queryRaw<Array<{ loggedIn: bigint; guest: bigint }>>`
    WITH search_sessions AS (
      SELECT DISTINCT "sessionId" FROM "SearchLog" WHERE "sessionId" IS NOT NULL AND "createdAt" >= ${since}
    ),
    first_touch AS (
      SELECT DISTINCT ON (pv."sessionId") pv."sessionId", pv."isLoggedIn"
      FROM "PageView" pv
      JOIN search_sessions s ON s."sessionId" = pv."sessionId"
      ORDER BY pv."sessionId", pv."createdAt" ASC
    )
    SELECT
      COUNT(*) FILTER (WHERE "isLoggedIn" = true)::bigint AS "loggedIn",
      COUNT(*) FILTER (WHERE "isLoggedIn" = false)::bigint AS guest
    FROM first_touch
  `;

  const result = {
    devices: rows.map((r) => ({ device: r.device, sessions: Number(r.sessions) })),
    loggedIn: Number(loggedInRows[0]?.loggedIn ?? 0),
    guest: Number(loggedInRows[0]?.guest ?? 0),
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Top cities among correlated search sessions — joins to PageView's already-recorded geoip-lite
 * lookup (see Phase 2) rather than running a second IP lookup per search. */
export async function getSearchesByCity(days?: number, limit = 10) {
  const cacheKey = `analytics:searches-by-city:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<Array<{ city: string; sessions: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ city: string; sessions: bigint }>>`
    WITH search_sessions AS (
      SELECT DISTINCT "sessionId" FROM "SearchLog" WHERE "sessionId" IS NOT NULL AND "createdAt" >= ${since}
    ),
    first_touch AS (
      SELECT DISTINCT ON (pv."sessionId") pv."sessionId", pv."city"
      FROM "PageView" pv
      JOIN search_sessions s ON s."sessionId" = pv."sessionId"
      WHERE pv."city" IS NOT NULL AND pv."city" != ''
      ORDER BY pv."sessionId", pv."createdAt" ASC
    )
    SELECT "city", COUNT(*)::bigint AS sessions
    FROM first_touch
    GROUP BY "city"
    ORDER BY sessions DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ city: r.city, sessions: Number(r.sessions) }));
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

/** Same device-classification regex as the SQL CASE in getDeviceBreakdown, as a plain JS
 * function — getRecentSessions builds its rows in JS from a raw userAgent column instead of a
 * grouped SQL aggregate, so it needs the equivalent logic client-side (server-side) here. */
function deviceFromUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown";
  if (/iPad|Tablet/i.test(userAgent)) return "Tablet";
  if (/Mobi|Android|iPhone/i.test(userAgent)) return "Mobile";
  return "Desktop";
}

/** OS family, sniffed from the same User-Agent header as getDeviceBreakdown/getBrowserBreakdown —
 * Android/iOS checked before Linux/Mac since their UAs also contain those substrings. */
export async function getOsBreakdown(days?: number) {
  const cacheKey = `analytics:os:${days ?? "all"}`;
  const cached = await cacheGet<Array<{ os: string; sessions: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ os: string; sessions: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", "userAgent"
      FROM "PageView"
      WHERE "createdAt" >= ${since}
      ORDER BY "sessionId", "createdAt" ASC
    )
    SELECT
      CASE
        WHEN "userAgent" IS NULL THEN 'Unknown'
        WHEN "userAgent" ~* 'Android' THEN 'Android'
        WHEN "userAgent" ~* 'iPhone|iPad|iPod' THEN 'iOS'
        WHEN "userAgent" ~* 'Windows' THEN 'Windows'
        WHEN "userAgent" ~* 'Mac OS X' THEN 'macOS'
        WHEN "userAgent" ~* 'Linux' THEN 'Linux'
        ELSE 'Other'
      END AS os,
      COUNT(*)::bigint AS sessions
    FROM first_touch
    GROUP BY os
    ORDER BY sessions DESC
  `;

  const result = rows.map((r) => ({ os: r.os, sessions: Number(r.sessions) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Sessions grouped by first-touch Accept-Language primary tag. */
export async function getLanguageBreakdown(days?: number, limit = 10) {
  const cacheKey = `analytics:languages:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<Array<{ language: string; sessions: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ language: string; sessions: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", "language"
      FROM "PageView"
      WHERE "createdAt" >= ${since}
      ORDER BY "sessionId", "createdAt" ASC
    )
    SELECT COALESCE("language", 'Unknown') AS language, COUNT(*)::bigint AS sessions
    FROM first_touch
    GROUP BY language
    ORDER BY sessions DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ language: r.language, sessions: Number(r.sessions) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Top countries/regions/cities by first-touch session — all from the geoip-lite lookup recorded
 * at pageview time (see trackPageView), so accuracy is only as good as that offline database. */
export async function getGeoBreakdown(days?: number, limit = 10) {
  const cacheKey = `analytics:geo:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<{
    countries: Array<{ countryCode: string; sessions: number }>;
    regions: Array<{ region: string; sessions: number }>;
    cities: Array<{ city: string; sessions: number }>;
  }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const [countryRows, regionRows, cityRows] = await Promise.all([
    prisma.$queryRaw<Array<{ countryCode: string; sessions: bigint }>>`
      WITH first_touch AS (
        SELECT DISTINCT ON ("sessionId") "sessionId", "countryCode"
        FROM "PageView"
        WHERE "createdAt" >= ${since} AND "countryCode" IS NOT NULL
        ORDER BY "sessionId", "createdAt" ASC
      )
      SELECT "countryCode", COUNT(*)::bigint AS sessions
      FROM first_touch
      GROUP BY "countryCode"
      ORDER BY sessions DESC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Array<{ region: string; sessions: bigint }>>`
      WITH first_touch AS (
        SELECT DISTINCT ON ("sessionId") "sessionId", "region", "countryCode"
        FROM "PageView"
        WHERE "createdAt" >= ${since} AND "region" IS NOT NULL
        ORDER BY "sessionId", "createdAt" ASC
      )
      SELECT (COALESCE("countryCode", '') || '-' || "region") AS region, COUNT(*)::bigint AS sessions
      FROM first_touch
      GROUP BY "countryCode", "region"
      ORDER BY sessions DESC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Array<{ city: string; sessions: bigint }>>`
      WITH first_touch AS (
        SELECT DISTINCT ON ("sessionId") "sessionId", "city"
        FROM "PageView"
        WHERE "createdAt" >= ${since} AND "city" IS NOT NULL AND "city" != ''
        ORDER BY "sessionId", "createdAt" ASC
      )
      SELECT "city", COUNT(*)::bigint AS sessions
      FROM first_touch
      GROUP BY "city"
      ORDER BY sessions DESC
      LIMIT ${limit}
    `,
  ]);

  const result = {
    countries: countryRows.map((r) => ({ countryCode: r.countryCode, sessions: Number(r.sessions) })),
    regions: regionRows.map((r) => ({ region: r.region, sessions: Number(r.sessions) })),
    cities: cityRows.map((r) => ({ city: r.city, sessions: Number(r.sessions) })),
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Sessions split by whether the visitor had a valid customer session cookie on their first
 * pageview — a session that logs in partway through still counts as "guest" here, same
 * first-touch simplification getDeviceBreakdown/getTrafficSources already make. */
export async function getLoggedInVsGuest(days?: number) {
  const cacheKey = `analytics:logged-in-vs-guest:${days ?? "all"}`;
  const cached = await cacheGet<{ loggedIn: number; guest: number }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ loggedIn: bigint; guest: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", "isLoggedIn"
      FROM "PageView"
      WHERE "createdAt" >= ${since}
      ORDER BY "sessionId", "createdAt" ASC
    )
    SELECT
      COUNT(*) FILTER (WHERE "isLoggedIn" = true)::bigint AS "loggedIn",
      COUNT(*) FILTER (WHERE "isLoggedIn" = false)::bigint AS guest
    FROM first_touch
  `;

  const result = { loggedIn: Number(rows[0]?.loggedIn ?? 0), guest: Number(rows[0]?.guest ?? 0) };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Top landing pages (first pageview of a session) and top exit pages (last pageview) — the
 * "where visitors arrive" / "where visitors give up" pair. */
export async function getEntryExitPages(days?: number, limit = 10) {
  const cacheKey = `analytics:entry-exit-pages:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<{
    entryPages: Array<{ path: string; sessions: number }>;
    exitPages: Array<{ path: string; sessions: number }>;
  }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const [entryRows, exitRows] = await Promise.all([
    prisma.$queryRaw<Array<{ path: string; sessions: bigint }>>`
      WITH first_touch AS (
        SELECT DISTINCT ON ("sessionId") "sessionId", path
        FROM "PageView"
        WHERE "createdAt" >= ${since}
        ORDER BY "sessionId", "createdAt" ASC
      )
      SELECT path, COUNT(*)::bigint AS sessions
      FROM first_touch
      GROUP BY path
      ORDER BY sessions DESC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Array<{ path: string; sessions: bigint }>>`
      WITH last_touch AS (
        SELECT DISTINCT ON ("sessionId") "sessionId", path
        FROM "PageView"
        WHERE "createdAt" >= ${since}
        ORDER BY "sessionId", "createdAt" DESC
      )
      SELECT path, COUNT(*)::bigint AS sessions
      FROM last_touch
      GROUP BY path
      ORDER BY sessions DESC
      LIMIT ${limit}
    `,
  ]);

  const result = {
    entryPages: entryRows.map((r) => ({ path: r.path, sessions: Number(r.sessions) })),
    exitPages: exitRows.map((r) => ({ path: r.path, sessions: Number(r.sessions) })),
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Engagement averages — time-per-page/scroll-depth/clicks only cover pageviews whose exit beacon
 * actually landed (durationMs IS NOT NULL); a tab killed before that beacon fires just isn't
 * counted, rather than skewing the average with a false zero. */
export async function getEngagementSummary(days?: number) {
  const cacheKey = `analytics:engagement:${days ?? "all"}`;
  const cached = await cacheGet<{
    avgTimePerPageMs: number;
    avgScrollDepthPct: number;
    avgClicksPerPage: number;
    avgSessionDurationMs: number;
    avgPagesPerSession: number;
  }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const [pageRows, sessionRows] = await Promise.all([
    prisma.$queryRaw<Array<{ avgDuration: number; avgScroll: number; avgClicks: number }>>`
      SELECT
        COALESCE(AVG("durationMs"), 0)::float AS "avgDuration",
        COALESCE(AVG("scrollDepthPct"), 0)::float AS "avgScroll",
        COALESCE(AVG("clickCount"), 0)::float AS "avgClicks"
      FROM "PageView"
      WHERE "createdAt" >= ${since} AND "durationMs" IS NOT NULL
    `,
    prisma.$queryRaw<Array<{ avgSessionDuration: number; avgPages: number }>>`
      WITH per_session AS (
        SELECT "sessionId", COALESCE(SUM("durationMs"), 0) AS total_duration, COUNT(*) AS pages
        FROM "PageView"
        WHERE "createdAt" >= ${since}
        GROUP BY "sessionId"
      )
      SELECT COALESCE(AVG(total_duration), 0)::float AS "avgSessionDuration", COALESCE(AVG(pages), 0)::float AS "avgPages"
      FROM per_session
    `,
  ]);

  const result = {
    avgTimePerPageMs: pageRows[0]?.avgDuration ?? 0,
    avgScrollDepthPct: pageRows[0]?.avgScroll ?? 0,
    avgClicksPerPage: pageRows[0]?.avgClicks ?? 0,
    avgSessionDurationMs: sessionRows[0]?.avgSessionDuration ?? 0,
    avgPagesPerSession: sessionRows[0]?.avgPages ?? 0,
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Histogram of how many distinct calendar days (lifetime, Asia/Dhaka) each known visitor has been
 * active on — "how sticky is the audience", not windowed since frequency is inherently a lifetime
 * measure. Visitors with no visitorId (pre-Phase-2 traffic) can't be bucketed and are excluded. */
export async function getReturningVisitorFrequency() {
  const cacheKey = "analytics:returning-visitor-frequency";
  const cached = await cacheGet<Array<{ bucket: string; visitors: number }>>(cacheKey);
  if (cached) return cached;

  const rows = await prisma.$queryRaw<Array<{ bucket: string; visitors: bigint }>>`
    WITH per_visitor_days AS (
      SELECT "visitorId", COUNT(DISTINCT date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')) AS "activeDays"
      FROM "PageView"
      WHERE "visitorId" IS NOT NULL
      GROUP BY "visitorId"
    )
    SELECT
      CASE
        WHEN "activeDays" = 1 THEN '1 day'
        WHEN "activeDays" BETWEEN 2 AND 3 THEN '2-3 days'
        WHEN "activeDays" BETWEEN 4 AND 7 THEN '4-7 days'
        ELSE '8+ days'
      END AS bucket,
      MIN("activeDays") AS "sortKey",
      COUNT(*)::bigint AS visitors
    FROM per_visitor_days
    GROUP BY bucket
    ORDER BY "sortKey" ASC
  `;

  const result = rows.map((r) => ({ bucket: r.bucket, visitors: Number(r.visitors) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Most recent N sessions with their entry/exit page, page count, total time on site, and device —
 * the "visitor timeline" view. A lighter-weight recent-activity table rather than a full
 * per-visitor drill-down/search page, which is out of scope for this phase. Cached briefly (not
 * the usual 300s) since "recent" is only useful if it stays close to live. */
export async function getRecentSessions(limit = 20) {
  const cacheKey = `analytics:recent-sessions:${limit}`;
  const cached = await cacheGet<
    Array<{
      sessionId: string;
      visitorId: string | null;
      entryPath: string;
      exitPath: string;
      pageCount: number;
      totalDurationMs: number;
      device: string;
      startedAt: string;
    }>
  >(cacheKey);
  if (cached) return cached;

  const rows = await prisma.$queryRaw<
    Array<{
      sessionId: string;
      visitorId: string | null;
      entryPath: string;
      exitPath: string;
      pageCount: bigint;
      totalDurationMs: number;
      userAgent: string | null;
      startedAt: Date;
    }>
  >`
    WITH session_bounds AS (
      SELECT "sessionId", MIN("createdAt") AS started_at
      FROM "PageView"
      GROUP BY "sessionId"
      ORDER BY started_at DESC
      LIMIT ${limit}
    ),
    entry AS (
      SELECT DISTINCT ON (pv."sessionId") pv."sessionId", pv.path AS entry_path, pv."visitorId", pv."userAgent"
      FROM "PageView" pv
      JOIN session_bounds sb ON sb."sessionId" = pv."sessionId"
      ORDER BY pv."sessionId", pv."createdAt" ASC
    ),
    exit AS (
      SELECT DISTINCT ON (pv."sessionId") pv."sessionId", pv.path AS exit_path
      FROM "PageView" pv
      JOIN session_bounds sb ON sb."sessionId" = pv."sessionId"
      ORDER BY pv."sessionId", pv."createdAt" DESC
    ),
    totals AS (
      SELECT pv."sessionId", COUNT(*)::bigint AS page_count, COALESCE(SUM(pv."durationMs"), 0)::float AS total_duration
      FROM "PageView" pv
      JOIN session_bounds sb ON sb."sessionId" = pv."sessionId"
      GROUP BY pv."sessionId"
    )
    SELECT
      sb."sessionId" AS "sessionId",
      entry."visitorId" AS "visitorId",
      entry.entry_path AS "entryPath",
      exit.exit_path AS "exitPath",
      totals.page_count AS "pageCount",
      totals.total_duration AS "totalDurationMs",
      entry."userAgent" AS "userAgent",
      sb.started_at AS "startedAt"
    FROM session_bounds sb
    JOIN entry ON entry."sessionId" = sb."sessionId"
    JOIN exit ON exit."sessionId" = sb."sessionId"
    JOIN totals ON totals."sessionId" = sb."sessionId"
    ORDER BY sb.started_at DESC
  `;

  const result = rows.map((r) => ({
    sessionId: r.sessionId,
    visitorId: r.visitorId,
    entryPath: r.entryPath,
    exitPath: r.exitPath,
    pageCount: Number(r.pageCount),
    totalDurationMs: r.totalDurationMs,
    device: deviceFromUserAgent(r.userAgent),
    startedAt: r.startedAt.toISOString(),
  }));
  await cacheSet(cacheKey, result, 60);
  return result;
}

export interface JourneyFunnelStep {
  key: string;
  label: string;
  sessions: number;
  /** % of the immediately preceding step — null for the first step (Landing), which has no
   * "previous" to compare against. */
  pctOfPrevious: number | null;
  /** % of Landing (the funnel's baseline) — lets the UI show overall reach alongside the
   * hop-to-hop conversion rate. */
  pctOfLanding: number;
}

export interface VisitorJourneyFunnel {
  /** 8 session-level steps: Landing, Category, Product, Variant Selected, Add to Cart, Checkout,
   * Payment, Success. Each counts "did this session reach step X" independently — not a strictly
   * ordered sequence (a session can view a product without a category page first). */
  steps: JourneyFunnelStep[];
  /** The step with the single largest percentage-point drop from its predecessor — null only if
   * there's no data at all. */
  bottleneckKey: string | null;
  /** Customer-level, lifetime, not a session-level funnel step — a single browsing session can't
   * itself be a repeat purchase. Reuses getCustomerInsights rather than recomputing. */
  repeatPurchase: { customers: number; totalCustomers: number; ratePct: number };
}

/** The Section-3 purchase funnel: Landing Page → Category → Product → Variant → Add to Cart →
 * Checkout → Payment → Success, plus lifetime Repeat Purchase as a distinct final metric.
 * "Payment" = an Order exists for the session (checkout was submitted) rather than
 * paymentStatus = PAID, since COD orders may never reach PAID before delivery and a failed online
 * payment still represents a real attempt. "Success" = reaching /order-confirmation/[orderNumber],
 * a payment-method-agnostic proxy that fires identically for COD and online payment. */
export async function getVisitorJourneyFunnel(days?: number): Promise<VisitorJourneyFunnel> {
  const cacheKey = `analytics:journey-funnel:${days ?? "all"}`;
  const cached = await cacheGet<VisitorJourneyFunnel>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);

  const [pageRows, eventRows, orderRows, customerInsights] = await Promise.all([
    prisma.$queryRaw<Array<{ landing: bigint; category: bigint; product: bigint; checkout: bigint; success: bigint }>>`
      SELECT
        COUNT(DISTINCT "sessionId")::bigint AS landing,
        COUNT(DISTINCT "sessionId") FILTER (WHERE path LIKE '/category/%')::bigint AS category,
        COUNT(DISTINCT "sessionId") FILTER (WHERE path LIKE '/product/%')::bigint AS product,
        COUNT(DISTINCT "sessionId") FILTER (WHERE path = '/checkout')::bigint AS checkout,
        COUNT(DISTINCT "sessionId") FILTER (WHERE path LIKE '/order-confirmation/%')::bigint AS success
      FROM "PageView"
      WHERE "createdAt" >= ${since}
    `,
    prisma.$queryRaw<Array<{ variant: bigint; addToCart: bigint }>>`
      SELECT
        COUNT(DISTINCT "sessionId") FILTER (WHERE type = 'VARIANT_SELECTED')::bigint AS variant,
        COUNT(DISTINCT "sessionId") FILTER (WHERE type = 'ADD_TO_CART')::bigint AS "addToCart"
      FROM "FunnelEvent"
      WHERE "createdAt" >= ${since}
    `,
    prisma.$queryRaw<Array<{ payment: bigint }>>`
      SELECT COUNT(DISTINCT "sessionId")::bigint AS payment
      FROM "Order"
      WHERE "sessionId" IS NOT NULL AND "createdAt" >= ${since}
    `,
    getCustomerInsights(),
  ]);

  const p = pageRows[0]!;
  const e = eventRows[0]!;
  const o = orderRows[0]!;

  const rawSteps = [
    { key: "landing", label: "Landing Page", sessions: Number(p.landing) },
    { key: "category", label: "Category", sessions: Number(p.category) },
    { key: "product", label: "Product", sessions: Number(p.product) },
    { key: "variant", label: "Variant Selected", sessions: Number(e.variant) },
    { key: "addToCart", label: "Add to Cart", sessions: Number(e.addToCart) },
    { key: "checkout", label: "Checkout", sessions: Number(p.checkout) },
    { key: "payment", label: "Payment", sessions: Number(o.payment) },
    { key: "success", label: "Success", sessions: Number(p.success) },
  ];

  const landingCount = rawSteps[0]!.sessions;
  let bottleneckKey: string | null = null;
  let biggestDropPct = -Infinity;

  const steps: JourneyFunnelStep[] = rawSteps.map((step, i) => {
    const prev = i === 0 ? null : rawSteps[i - 1]!.sessions;
    const pctOfPrevious = prev === null ? null : prev > 0 ? (step.sessions / prev) * 100 : 0;
    const pctOfLanding = landingCount > 0 ? (step.sessions / landingCount) * 100 : 0;
    // Steps are counted independently, not as strict subsets (a session can view a product
    // without a category page first), so a later step can have *more* sessions than the one
    // before it — that's not a "negative drop-off", it's just two independently-sized groups.
    // Bottleneck detection only considers pairs where sessions actually decreased; a step that
    // grew from its predecessor is never eligible, however small dropPct's magnitude would be.
    if (i > 0 && pctOfPrevious !== null && pctOfPrevious <= 100) {
      const dropPct = 100 - pctOfPrevious;
      if (dropPct > biggestDropPct) {
        biggestDropPct = dropPct;
        bottleneckKey = step.key;
      }
    }
    return { ...step, pctOfPrevious, pctOfLanding };
  });

  const result: VisitorJourneyFunnel = {
    steps,
    bottleneckKey,
    repeatPurchase: {
      customers: customerInsights.returningCustomers,
      totalCustomers: customerInsights.totalCustomers,
      ratePct: customerInsights.returningRate,
    },
  };

  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Products ranked by how often a given FunnelEvent type fired for them — the shared shape behind
 * getMostAddedToCart/getMostRemovedFromCart below. `type` is hardcoded per call site rather than
 * parameterized: FunnelEventType is a Postgres enum, and binding an enum comparison through a
 * $queryRaw parameter risks a type-inference mismatch that a literal in the SQL text never does
 * (every other enum comparison in this file — e.g. `status != 'CANCELLED'` — is a literal for the
 * same reason). */
export async function getMostAddedToCart(days?: number, limit = 10) {
  const cacheKey = `analytics:most-added-to-cart:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<Array<{ id: string; name: string; slug: string; count: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; count: bigint }>>`
    SELECT p.id, p.name, p.slug, COUNT(*)::bigint AS count
    FROM "FunnelEvent" fe
    JOIN "Product" p ON p.id = fe."productId"
    WHERE fe.type = 'ADD_TO_CART' AND fe."createdAt" >= ${since}
    GROUP BY p.id, p.name, p.slug
    ORDER BY count DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, count: Number(r.count) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

export async function getMostRemovedFromCart(days?: number, limit = 10) {
  const cacheKey = `analytics:most-removed-from-cart:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<Array<{ id: string; name: string; slug: string; count: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; count: bigint }>>`
    SELECT p.id, p.name, p.slug, COUNT(*)::bigint AS count
    FROM "FunnelEvent" fe
    JOIN "Product" p ON p.id = fe."productId"
    WHERE fe.type = 'REMOVE_FROM_CART' AND fe."createdAt" >= ${since}
    GROUP BY p.id, p.name, p.slug
    ORDER BY count DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, count: Number(r.count) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Lifetime, not windowed — wishlisting is a cumulative, low-frequency signal (unlike pageviews or
 * cart adds), so "most wishlisted right now" isn't a meaningfully different question from "most
 * wishlisted ever" the way a 7-day window is for high-frequency events elsewhere in this file. */
export async function getMostWishlisted(limit = 10) {
  const cacheKey = `analytics:most-wishlisted:${limit}`;
  const cached = await cacheGet<Array<{ id: string; name: string; slug: string; count: number }>>(cacheKey);
  if (cached) return cached;

  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; count: bigint }>>`
    SELECT p.id, p.name, p.slug, COUNT(*)::bigint AS count
    FROM "WishlistItem" w
    JOIN "Product" p ON p.id = w."productId"
    GROUP BY p.id, p.name, p.slug
    ORDER BY count DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, count: Number(r.count) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Browse-to-buy ratio per product: distinct orders containing the product ÷ ProductViewLog views
 * in the window. Returns the full ranked list (capped at 500 for safety, not the usual small
 * `limit`) rather than a single top-N — the UI reads both ends of the same sorted array for
 * "highest" and "lowest" conversion, so there's no need for two endpoints. Only products with at
 * least one view are included; a product nobody viewed has no meaningful conversion rate to rank. */
export async function getProductConversionRates(days?: number) {
  const cacheKey = `analytics:product-conversion:${days ?? "all"}`;
  const cached = await cacheGet<Array<{ id: string; name: string; slug: string; views: number; orders: number; conversionRatePct: number }>>(
    cacheKey,
  );
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; views: bigint; orders: bigint }>>`
    WITH views AS (
      SELECT "productId", COUNT(*)::bigint AS views
      FROM "ProductViewLog"
      WHERE "createdAt" >= ${since}
      GROUP BY "productId"
    ),
    product_orders AS (
      SELECT pv."productId" AS "productId", COUNT(DISTINCT oi."orderId")::bigint AS orders
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "ProductVariant" pv ON pv.id = oi."variantId"
      WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
      GROUP BY pv."productId"
    )
    SELECT p.id, p.name, p.slug, v.views, COALESCE(po.orders, 0) AS orders
    FROM views v
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN product_orders po ON po."productId" = p.id
    ORDER BY (COALESCE(po.orders, 0)::float / v.views) DESC
    LIMIT 500
  `;

  const result = rows.map((r) => {
    const views = Number(r.views);
    const orders = Number(r.orders);
    return { id: r.id, name: r.name, slug: r.slug, views, orders, conversionRatePct: views > 0 ? (orders / views) * 100 : 0 };
  });
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Revenue minus estimated COGS per product — same current-cost-price approximation Phase 1's
 * executive overview already accepts for gross profit (OrderItem never snapshotted cost at sale
 * time), applied per product instead of store-wide. */
export async function getHighestProfitProducts(days?: number, limit = 10) {
  const cacheKey = `analytics:highest-profit-products:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<Array<{ id: string; name: string; slug: string; revenue: number; cogs: number; profit: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; revenue: number; cogs: number }>>`
    SELECT p.id, p.name, p.slug,
      SUM(oi.quantity * oi."priceSnapshot")::float AS revenue,
      SUM(oi.quantity * COALESCE(pv."costPrice", p."costPrice", 0))::float AS cogs
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    JOIN "ProductVariant" pv ON pv.id = oi."variantId"
    JOIN "Product" p ON p.id = pv."productId"
    WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
    GROUP BY p.id, p.name, p.slug
    ORDER BY (SUM(oi.quantity * oi."priceSnapshot") - SUM(oi.quantity * COALESCE(pv."costPrice", p."costPrice", 0))) DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, revenue: r.revenue, cogs: r.cogs, profit: r.revenue - r.cogs }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Return rate uses OrderItem.returnedQuantity — the correct, unambiguous per-line-item source
 * (ReturnRequest.orderItemId is only ever populated for EXCHANGE, not the common RETURN case, so
 * it can't reliably attribute a return to one product). Refund rate is necessarily an order-level
 * proxy instead: of orders containing this product, what fraction ended up paymentStatus =
 * REFUNDED — neither ReturnRequest nor Order snapshots a per-item refund amount, so this is a
 * signal about the order, not an exact per-item figure. Ranked by return rate. */
export async function getProductRiskMetrics(days?: number, limit = 10) {
  const cacheKey = `analytics:product-risk:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<
    Array<{ id: string; name: string; slug: string; returnRatePct: number; refundRatePct: number; totalOrders: number }>
  >(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; slug: string; totalQty: bigint; returnedQty: bigint; totalOrders: bigint; refundedOrders: bigint }>
  >`
    WITH item_stats AS (
      SELECT pv."productId" AS "productId",
        SUM(oi.quantity)::bigint AS "totalQty",
        SUM(oi."returnedQuantity")::bigint AS "returnedQty",
        COUNT(DISTINCT oi."orderId")::bigint AS "totalOrders",
        COUNT(DISTINCT oi."orderId") FILTER (WHERE o."paymentStatus" = 'REFUNDED')::bigint AS "refundedOrders"
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "ProductVariant" pv ON pv.id = oi."variantId"
      WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
      GROUP BY pv."productId"
    )
    SELECT p.id, p.name, p.slug, s."totalQty", s."returnedQty", s."totalOrders", s."refundedOrders"
    FROM item_stats s
    JOIN "Product" p ON p.id = s."productId"
    WHERE s."totalQty" > 0
    ORDER BY (s."returnedQty"::float / s."totalQty") DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => {
    const totalQty = Number(r.totalQty);
    const totalOrders = Number(r.totalOrders);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      returnRatePct: totalQty > 0 ? (Number(r.returnedQty) / totalQty) * 100 : 0,
      refundRatePct: totalOrders > 0 ? (Number(r.refundedOrders) / totalOrders) * 100 : 0,
      totalOrders,
    };
  });
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Admin-wide co-purchase pairs, distinct from the single-product getFrequentlyBoughtTogether in
 * product.service.ts (storefront-facing, scoped to one product's own recommendations) — same
 * join shape, aggregated across the whole catalog instead. `a."productId" < b."productId"`
 * dedupes symmetric pairs (A,B) and (B,A) into one row and excludes self-pairs in a single
 * condition. */
export async function getFrequentlyBoughtTogetherPairs(days?: number, limit = 10) {
  const cacheKey = `analytics:fbt-pairs:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<Array<{ productA: string; productB: string; coCount: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ productA: string; productB: string; coCount: bigint }>>`
    WITH order_products AS (
      SELECT DISTINCT o.id AS order_id, pv."productId" AS "productId"
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "ProductVariant" pv ON pv.id = oi."variantId"
      WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
    ),
    pairs AS (
      SELECT a."productId" AS product_a, b."productId" AS product_b, COUNT(DISTINCT a.order_id)::bigint AS "coCount"
      FROM order_products a
      JOIN order_products b ON a.order_id = b.order_id AND a."productId" < b."productId"
      GROUP BY a."productId", b."productId"
    )
    SELECT pa.name AS "productA", pb.name AS "productB", pairs."coCount"
    FROM pairs
    JOIN "Product" pa ON pa.id = pairs.product_a
    JOIN "Product" pb ON pb.id = pairs.product_b
    ORDER BY pairs."coCount" DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ productA: r.productA, productB: r.productB, coCount: Number(r.coCount) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

export interface ProductSalesHeatmap {
  products: Array<{ id: string; name: string; totalQty: number }>;
  days: string[];
  /** cells[productId][date] = units sold, zero-filled for every product×day combination. */
  cells: Record<string, Record<string, number>>;
}

/** Top-N-products × last-N-days units-sold intensity grid — "Product Heatmap" has no established
 * BI-specific meaning distinct from Section 12's click/scroll heatmaps, so this interprets it as
 * "which products are hot on which days", the same day-grid pattern already used by
 * traffic-heatmap.tsx for site-wide traffic. Always windowed (no "all time" option — a 365-day-wide
 * grid isn't a readable heatmap), defaulting to 14 days. */
export async function getProductSalesHeatmap(days = 14, limit = 10): Promise<ProductSalesHeatmap> {
  const cacheKey = `analytics:product-sales-heatmap:${days}:${limit}`;
  const cached = await cacheGet<ProductSalesHeatmap>(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const topProducts = await prisma.$queryRaw<Array<{ id: string; name: string; totalQty: bigint }>>`
    SELECT p.id, p.name, SUM(oi.quantity)::bigint AS "totalQty"
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    JOIN "ProductVariant" pv ON pv.id = oi."variantId"
    JOIN "Product" p ON p.id = pv."productId"
    WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
    GROUP BY p.id, p.name
    ORDER BY "totalQty" DESC
    LIMIT ${limit}
  `;

  const dayKeys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  const cells: Record<string, Record<string, number>> = {};
  for (const p of topProducts) cells[p.id] = Object.fromEntries(dayKeys.map((k) => [k, 0]));

  if (topProducts.length > 0) {
    const productIds = topProducts.map((p) => p.id);
    const dailyRows = await prisma.$queryRaw<Array<{ productId: string; day: Date; qty: bigint }>>`
      SELECT pv."productId" AS "productId", date_trunc('day', o."createdAt") AS day, SUM(oi.quantity)::bigint AS qty
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "ProductVariant" pv ON pv.id = oi."variantId"
      WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since} AND pv."productId" IN (${Prisma.join(productIds)})
      GROUP BY pv."productId", day
    `;
    for (const row of dailyRows) {
      const key = row.day.toISOString().slice(0, 10);
      if (cells[row.productId] && key in cells[row.productId]!) cells[row.productId]![key] = Number(row.qty);
    }
  }

  const result: ProductSalesHeatmap = {
    products: topProducts.map((p) => ({ id: p.id, name: p.name, totalQty: Number(p.totalQty) })),
    days: dayKeys,
    cells,
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Units/revenue by exact SKU, from OrderItem's own snapshot fields — deliberately not joined to
 * the live ProductVariant/Product (unlike the other new rankings in this file), the same reasoning
 * getTopProducts already applies: a variant-level "what sold" report needs to survive that exact
 * variant being renamed or deleted since, to stay historically accurate. */
export async function getVariantPerformance(days?: number, limit = 10) {
  const cacheKey = `analytics:variant-performance:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<Array<{ sku: string; productName: string; size: string; color: string; unitsSold: number; revenue: number }>>(
    cacheKey,
  );
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<
    Array<{ sku: string; productName: string; size: string; color: string; unitsSold: bigint; revenue: number }>
  >`
    SELECT oi."skuSnapshot" AS sku, oi."productNameSnapshot" AS "productName", oi."sizeSnapshot" AS size, oi."colorSnapshot" AS color,
      SUM(oi.quantity)::bigint AS "unitsSold",
      SUM(oi.quantity * oi."priceSnapshot")::float AS revenue
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
    GROUP BY oi."skuSnapshot", oi."productNameSnapshot", oi."sizeSnapshot", oi."colorSnapshot"
    ORDER BY "unitsSold" DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({
    sku: r.sku,
    productName: r.productName,
    size: r.size,
    color: r.color,
    unitsSold: Number(r.unitsSold),
    revenue: r.revenue,
  }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Size and color breakdowns, one query each but one function/cache-entry — same "combine related
 * breakdowns in one call" pattern as getSearchAudience. Snapshot-based, same reasoning as
 * getVariantPerformance above. */
export async function getSizeColorPerformance(days?: number) {
  const cacheKey = `analytics:size-color-performance:${days ?? "all"}`;
  const cached = await cacheGet<{
    sizes: Array<{ value: string; unitsSold: number; revenue: number }>;
    colors: Array<{ value: string; unitsSold: number; revenue: number }>;
  }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const [sizeRows, colorRows] = await Promise.all([
    prisma.$queryRaw<Array<{ value: string; unitsSold: bigint; revenue: number }>>`
      SELECT oi."sizeSnapshot" AS value, SUM(oi.quantity)::bigint AS "unitsSold", SUM(oi.quantity * oi."priceSnapshot")::float AS revenue
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
      GROUP BY oi."sizeSnapshot"
      ORDER BY "unitsSold" DESC
    `,
    prisma.$queryRaw<Array<{ value: string; unitsSold: bigint; revenue: number }>>`
      SELECT oi."colorSnapshot" AS value, SUM(oi.quantity)::bigint AS "unitsSold", SUM(oi.quantity * oi."priceSnapshot")::float AS revenue
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
      GROUP BY oi."colorSnapshot"
      ORDER BY "unitsSold" DESC
    `,
  ]);

  const result = {
    sizes: sizeRows.map((r) => ({ value: r.value, unitsSold: Number(r.unitsSold), revenue: r.revenue })),
    colors: colorRows.map((r) => ({ value: r.value, unitsSold: Number(r.unitsSold), revenue: r.revenue })),
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** COGS sold in the window ÷ current inventory value, per product — the standard practical
 * substitute for time-weighted average inventory when (as here) there's no historical stock
 * snapshot to compute a true average from, same class of approximation as Phase 1's
 * current-cost-price gross profit. Ranked descending: highest turnover = moving fastest relative
 * to what's currently held. */
export async function getInventoryTurnover(days?: number, limit = 10) {
  const cacheKey = `analytics:inventory-turnover:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<Array<{ id: string; name: string; slug: string; cogsSold: number; inventoryValue: number; turnoverRatio: number }>>(
    cacheKey,
  );
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; inventoryValue: number; cogsSold: number }>>`
    WITH sold AS (
      SELECT pv."productId" AS "productId", SUM(oi.quantity * COALESCE(pv."costPrice", p."costPrice", 0))::float AS "cogsSold"
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "ProductVariant" pv ON pv.id = oi."variantId"
      JOIN "Product" p ON p.id = pv."productId"
      WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
      GROUP BY pv."productId"
    ),
    inventory AS (
      SELECT p.id, p.name, p.slug, SUM(pv.stock * COALESCE(pv."costPrice", p."costPrice", 0))::float AS "inventoryValue"
      FROM "Product" p
      JOIN "ProductVariant" pv ON pv."productId" = p.id
      WHERE p."isActive" = true AND p."deletedAt" IS NULL
      GROUP BY p.id, p.name, p.slug
    )
    SELECT inv.id, inv.name, inv.slug, inv."inventoryValue", COALESCE(sold."cogsSold", 0) AS "cogsSold"
    FROM inventory inv
    LEFT JOIN sold ON sold."productId" = inv.id
    WHERE inv."inventoryValue" > 0
    ORDER BY (COALESCE(sold."cogsSold", 0) / inv."inventoryValue") DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    cogsSold: r.cogsSold,
    inventoryValue: r.inventoryValue,
    turnoverRatio: r.inventoryValue > 0 ? r.cogsSold / r.inventoryValue : 0,
  }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Recency (days since last order) / Frequency (order count) / Monetary (lifetime spend) per
 * customer, sorted by monetary value — the honest version of "RFM analysis" at this store's
 * actual scale. True quintile-scored RFM assumes a population large enough for meaningful
 * buckets; reusing this store's existing threshold-based segmentation (via
 * loadCustomersWithComputedFields, the exact same tag logic the customers list already shows) is
 * more accurate than a statistically-hollow quintile scorer would be here. Only customers with
 * ≥1 order are included — recency/frequency/monetary have no meaning for someone who never
 * bought anything. */
export async function getCustomerRfmTable(limit = 50) {
  const cacheKey = `analytics:customer-rfm:${limit}`;
  const cached = await cacheGet<
    Array<{ id: string; name: string; recencyDays: number | null; frequency: number; monetary: number; tags: string[] }>
  >(cacheKey);
  if (cached) return cached;

  const customers = await loadCustomersWithComputedFields({});
  const now = Date.now();
  const result = customers
    .filter((c) => c.totalOrders > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      recencyDays: c.lastOrderAt ? Math.floor((now - c.lastOrderAt.getTime()) / (24 * 60 * 60 * 1000)) : null,
      frequency: c.totalOrders,
      monetary: c.totalSpent,
      tags: c.tags as string[],
    }))
    .sort((a, b) => b.monetary - a.monetary)
    .slice(0, limit);

  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** How many orders customers place, lifetime — same bucket shape as Phase 2's
 * getReturningVisitorFrequency, applied to purchase count instead of active days. */
export async function getPurchaseFrequencyDistribution() {
  const cacheKey = "analytics:purchase-frequency";
  const cached = await cacheGet<Array<{ bucket: string; customers: number }>>(cacheKey);
  if (cached) return cached;

  const customers = await loadCustomersWithComputedFields({});
  const withOrders = customers.filter((c) => c.totalOrders > 0);

  const buckets: Array<{ bucket: string; test: (n: number) => boolean }> = [
    { bucket: "1 order", test: (n) => n === 1 },
    { bucket: "2-3 orders", test: (n) => n >= 2 && n <= 3 },
    { bucket: "4-7 orders", test: (n) => n >= 4 && n <= 7 },
    { bucket: "8+ orders", test: (n) => n >= 8 },
  ];

  const result = buckets.map(({ bucket, test }) => ({ bucket, customers: withOrders.filter((c) => test(c.totalOrders)).length }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Order count/revenue by payment method — COD vs. the two online gateways. */
export async function getFavoritePaymentMethod(days?: number) {
  const cacheKey = `analytics:favorite-payment-method:${days ?? "all"}`;
  const cached = await cacheGet<Array<{ method: string; orders: number; revenue: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ method: string; orders: bigint; revenue: number }>>`
    SELECT "paymentMethod" AS method, COUNT(*)::bigint AS orders, COALESCE(SUM(total), 0)::float AS revenue
    FROM "Order"
    WHERE status != 'CANCELLED' AND "createdAt" >= ${since}
    GROUP BY "paymentMethod"
    ORDER BY orders DESC
  `;

  const result = rows.map((r) => ({ method: r.method, orders: Number(r.orders), revenue: r.revenue }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Hour-of-day (0-23) and day-of-week order counts, Asia/Dhaka local time — same
 * naive-timestamp-in-local-time idiom as getTrafficHeatmap, applied to Order.createdAt instead of
 * PageView.createdAt. One dimension at a time (not a 7×24 grid) since "most purchased time" is
 * asked as a single question, not a matrix. */
export async function getPurchaseTimeDistribution(days?: number) {
  const cacheKey = `analytics:purchase-time:${days ?? "all"}`;
  const cached = await cacheGet<{ byHour: Array<{ hour: number; orders: number }>; byDayOfWeek: Array<{ dow: number; orders: number }> }>(
    cacheKey,
  );
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ hour: number; dow: number; orders: bigint }>>`
    SELECT
      EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')::int AS hour,
      EXTRACT(DOW FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')::int AS dow,
      COUNT(*)::bigint AS orders
    FROM "Order"
    WHERE status != 'CANCELLED' AND "createdAt" >= ${since}
    GROUP BY hour, dow
  `;

  const byHourMap = new Map<number, number>();
  const byDowMap = new Map<number, number>();
  for (const r of rows) {
    byHourMap.set(r.hour, (byHourMap.get(r.hour) ?? 0) + Number(r.orders));
    byDowMap.set(r.dow, (byDowMap.get(r.dow) ?? 0) + Number(r.orders));
  }

  const result = {
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: byHourMap.get(hour) ?? 0 })),
    byDayOfWeek: Array.from({ length: 7 }, (_, dow) => ({ dow, orders: byDowMap.get(dow) ?? 0 })),
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Orders grouped by shipping division and district — "which city buys the most", one query/
 * cache-entry for both groupings, same pattern as Phase 4's getSearchAudience. */
export async function getCustomerLocationBreakdown(days?: number, limit = 10) {
  const cacheKey = `analytics:customer-location:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<{
    divisions: Array<{ division: string; orders: number; revenue: number }>;
    districts: Array<{ district: string; orders: number; revenue: number }>;
  }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const [divisionRows, districtRows] = await Promise.all([
    prisma.$queryRaw<Array<{ division: string; orders: bigint; revenue: number }>>`
      SELECT "shippingDivision" AS division, COUNT(*)::bigint AS orders, COALESCE(SUM(total), 0)::float AS revenue
      FROM "Order"
      WHERE status != 'CANCELLED' AND "createdAt" >= ${since}
      GROUP BY "shippingDivision"
      ORDER BY orders DESC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Array<{ district: string; orders: bigint; revenue: number }>>`
      SELECT "shippingDistrict" AS district, COUNT(*)::bigint AS orders, COALESCE(SUM(total), 0)::float AS revenue
      FROM "Order"
      WHERE status != 'CANCELLED' AND "createdAt" >= ${since}
      GROUP BY "shippingDistrict"
      ORDER BY orders DESC
      LIMIT ${limit}
    `,
  ]);

  const result = {
    divisions: divisionRows.map((r) => ({ division: r.division, orders: Number(r.orders), revenue: r.revenue })),
    districts: districtRows.map((r) => ({ district: r.district, orders: Number(r.orders), revenue: r.revenue })),
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

// ---------------------------------------------------------------------------
// Section 7 — Marketing Intelligence. Traffic-source/UTM attribution and campaign performance
// already exist above (getTrafficSources, getCampaignPerformance, Phase 2) — these are the
// remaining marketing levers: coupons, bundles, flash sales, bulk email/SMS/push campaigns, and
// the reward-points ledger. No referral program exists anywhere in the schema, so it isn't here.
// ---------------------------------------------------------------------------

/** Per-coupon redemption volume, discount given, and revenue attributed — join on Order.couponId,
 * the only place a coupon's usage is recorded. */
export async function getCouponEffectiveness(days?: number, limit = 10) {
  const cacheKey = `analytics:coupon-effectiveness:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<Array<{ code: string; type: string; orders: number; discountGiven: number; revenue: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ code: string; type: string; orders: bigint; discountGiven: number; revenue: number }>>`
    SELECT c.code, c.type::text AS type, COUNT(o.id)::bigint AS orders,
      COALESCE(SUM(o.discount), 0)::float AS "discountGiven", COALESCE(SUM(o.total), 0)::float AS revenue
    FROM "Coupon" c
    JOIN "Order" o ON o."couponId" = c.id
    WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
    GROUP BY c.id, c.code, c.type
    ORDER BY orders DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ code: r.code, type: r.type, orders: Number(r.orders), discountGiven: r.discountGiven, revenue: r.revenue }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Per-bundle redemption volume, discount given, and revenue — the category cross-sell bundles
 * (see Bundle model), not coupons. */
export async function getBundlePerformance(days?: number, limit = 10) {
  const cacheKey = `analytics:bundle-performance:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<Array<{ name: string; orders: number; discountGiven: number; revenue: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ name: string; orders: bigint; discountGiven: number; revenue: number }>>`
    SELECT b.name, COUNT(o.id)::bigint AS orders,
      COALESCE(SUM(o."bundleDiscount"), 0)::float AS "discountGiven", COALESCE(SUM(o.total), 0)::float AS revenue
    FROM "Bundle" b
    JOIN "Order" o ON o."bundleId" = b.id
    WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
    GROUP BY b.id, b.name
    ORDER BY orders DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ name: r.name, orders: Number(r.orders), discountGiven: r.discountGiven, revenue: r.revenue }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Units/revenue actually sold *during* each flash sale's own window, for the products it
 * discounted — not just any sale of those products. There's no direct OrderItem -> FlashSaleItem
 * link, so a sale is attributed to a flash sale by matching product + the order falling inside
 * that sale's [startsAt, endsAt]. */
export async function getFlashSalePerformance(limit = 10) {
  const cacheKey = `analytics:flash-sale-performance:${limit}`;
  const cached = await cacheGet<
    Array<{ id: string; name: string; startsAt: string; endsAt: string; unitsSold: number; revenue: number }>
  >(cacheKey);
  if (cached) return cached;

  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; startsAt: Date; endsAt: Date; unitsSold: bigint; revenue: number }>
  >`
    WITH sale_variants AS (
      SELECT fs.id AS "flashSaleId", fs.name, fs."startsAt", fs."endsAt", pv.id AS "variantId"
      FROM "FlashSale" fs
      JOIN "FlashSaleItem" fsi ON fsi."flashSaleId" = fs.id
      JOIN "ProductVariant" pv ON pv."productId" = fsi."productId"
    ),
    sales AS (
      SELECT sv."flashSaleId", SUM(oi.quantity)::bigint AS "unitsSold", SUM(oi.quantity * oi."priceSnapshot")::float AS revenue
      FROM sale_variants sv
      JOIN "OrderItem" oi ON oi."variantId" = sv."variantId"
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o.status != 'CANCELLED' AND o."createdAt" >= sv."startsAt" AND o."createdAt" <= sv."endsAt"
      GROUP BY sv."flashSaleId"
    ),
    sales_meta AS (
      SELECT DISTINCT "flashSaleId", name, "startsAt", "endsAt" FROM sale_variants
    )
    SELECT m."flashSaleId" AS id, m.name, m."startsAt", m."endsAt",
      COALESCE(s."unitsSold", 0)::bigint AS "unitsSold", COALESCE(s.revenue, 0)::float AS revenue
    FROM sales_meta m
    LEFT JOIN sales s ON s."flashSaleId" = m."flashSaleId"
    ORDER BY m."startsAt" DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({
    id: r.id,
    name: r.name,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    unitsSold: Number(r.unitsSold),
    revenue: r.revenue,
  }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Per-campaign delivery outcome for the bulk email/SMS/push sender — distinct from
 * getCampaignPerformance above, which attributes storefront revenue to a UTM campaign string;
 * this is about whether the send itself succeeded. */
export async function getCampaignDeliveryStats(limit = 10) {
  const cacheKey = `analytics:campaign-delivery:${limit}`;
  const cached = await cacheGet<Array<{ id: string; name: string; channel: string; sent: number; failed: number; pending: number; total: number }>>(
    cacheKey,
  );
  if (cached) return cached;

  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; channel: string; sent: bigint; failed: bigint; pending: bigint; total: bigint }>
  >`
    SELECT c.id, c.name, c.channel::text AS channel,
      COUNT(*) FILTER (WHERE cr.status = 'SENT')::bigint AS sent,
      COUNT(*) FILTER (WHERE cr.status = 'FAILED')::bigint AS failed,
      COUNT(*) FILTER (WHERE cr.status = 'PENDING')::bigint AS pending,
      COUNT(*)::bigint AS total
    FROM "Campaign" c
    JOIN "CampaignRecipient" cr ON cr."campaignId" = c.id
    GROUP BY c.id, c.name, c.channel, c."createdAt"
    ORDER BY c."createdAt" DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({
    id: r.id,
    name: r.name,
    channel: r.channel,
    sent: Number(r.sent),
    failed: Number(r.failed),
    pending: Number(r.pending),
    total: Number(r.total),
  }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Lifetime reward-points ledger totals — issued vs. redeemed vs. currently outstanding, plus how
 * many customers are actually holding a balance. `RewardPointsEntry.points` is signed (positive =
 * earned, negative = redeemed), so this is a straight sum split by sign. */
export async function getLoyaltyPointsOverview() {
  const cacheKey = "analytics:loyalty-points-overview";
  const cached = await cacheGet<{ issued: number; redeemed: number; outstanding: number; customersWithBalance: number }>(cacheKey);
  if (cached) return cached;

  const [rows, customersWithBalance] = await Promise.all([
    prisma.$queryRaw<Array<{ issued: number; redeemed: number }>>`
      SELECT COALESCE(SUM(points) FILTER (WHERE points > 0), 0)::float AS issued,
        COALESCE(SUM(points) FILTER (WHERE points < 0), 0)::float AS redeemed
      FROM "RewardPointsEntry"
    `,
    prisma.customer.count({ where: { rewardPoints: { gt: 0 } } }),
  ]);

  const row = rows[0] ?? { issued: 0, redeemed: 0 };
  const result = { issued: row.issued, redeemed: Math.abs(row.redeemed), outstanding: row.issued + row.redeemed, customersWithBalance };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

// ---------------------------------------------------------------------------
// Section 8 — Sales Intelligence. Order volume/status/payment-method are already covered above
// (getOrderStatusCounts, getRevenueSeries, getFavoritePaymentMethod from Phase 6) — these add
// discount usage, return/exchange reasons, and courier delivery performance/loss.
// ---------------------------------------------------------------------------

/** How much of order revenue is discounted, lifetime or windowed — coupon and bundle discounts
 * counted separately since they're independent mechanisms (an order can carry either or both). */
export async function getDiscountUsageBreakdown(days?: number) {
  const cacheKey = `analytics:discount-usage:${days ?? "all"}`;
  const cached = await cacheGet<{
    totalOrders: number;
    ordersWithDiscount: number;
    discountedOrderRatePct: number;
    couponDiscountTotal: number;
    bundleDiscountTotal: number;
    subtotalTotal: number;
    discountRatePct: number;
  }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<
    Array<{ totalOrders: bigint; ordersWithDiscount: bigint; couponDiscountTotal: number; bundleDiscountTotal: number; subtotalTotal: number }>
  >`
    SELECT COUNT(*)::bigint AS "totalOrders",
      COUNT(*) FILTER (WHERE "couponId" IS NOT NULL OR "bundleId" IS NOT NULL)::bigint AS "ordersWithDiscount",
      COALESCE(SUM(discount), 0)::float AS "couponDiscountTotal",
      COALESCE(SUM("bundleDiscount"), 0)::float AS "bundleDiscountTotal",
      COALESCE(SUM(subtotal), 0)::float AS "subtotalTotal"
    FROM "Order"
    WHERE status != 'CANCELLED' AND "createdAt" >= ${since}
  `;

  const row = rows[0]!;
  const totalOrders = Number(row.totalOrders);
  const ordersWithDiscount = Number(row.ordersWithDiscount);
  const totalDiscount = row.couponDiscountTotal + row.bundleDiscountTotal;
  const result = {
    totalOrders,
    ordersWithDiscount,
    discountedOrderRatePct: totalOrders > 0 ? (ordersWithDiscount / totalOrders) * 100 : 0,
    couponDiscountTotal: row.couponDiscountTotal,
    bundleDiscountTotal: row.bundleDiscountTotal,
    subtotalTotal: row.subtotalTotal,
    discountRatePct: row.subtotalTotal > 0 ? (totalDiscount / row.subtotalTotal) * 100 : 0,
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Return/exchange request volume by type + status, plus the most common reasons — `reason` is
 * free text (customers type it), so only exact repeats group together; it's a signal, not a
 * clustered taxonomy. */
export async function getReturnRequestAnalytics(days?: number) {
  const cacheKey = `analytics:return-request-analytics:${days ?? "all"}`;
  const cached = await cacheGet<{
    byTypeStatus: Array<{ type: string; status: string; count: number }>;
    topReasons: Array<{ reason: string; count: number }>;
  }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const [typeStatusRows, reasonRows] = await Promise.all([
    prisma.$queryRaw<Array<{ type: string; status: string; count: bigint }>>`
      SELECT type::text AS type, status::text AS status, COUNT(*)::bigint AS count
      FROM "ReturnRequest"
      WHERE "createdAt" >= ${since}
      GROUP BY type, status
      ORDER BY count DESC
    `,
    prisma.$queryRaw<Array<{ reason: string; count: bigint }>>`
      SELECT reason, COUNT(*)::bigint AS count
      FROM "ReturnRequest"
      WHERE "createdAt" >= ${since}
      GROUP BY reason
      ORDER BY count DESC
      LIMIT 10
    `,
  ]);

  const result = {
    byTypeStatus: typeStatusRows.map((r) => ({ type: r.type, status: r.status, count: Number(r.count) })),
    topReasons: reasonRows.map((r) => ({ reason: r.reason, count: Number(r.count) })),
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Steadfast delivery-outcome breakdown for booked orders, plus the courier-loss ledger
 * (CourierLossEvent) by reason — the two together answer "how is the courier actually performing
 * and what is it costing us", since Steadfast's API exposes no per-order fee to compute the
 * latter from directly (see CourierLossEvent's schema comment). */
export async function getCourierPerformance(days?: number) {
  const cacheKey = `analytics:courier-performance:${days ?? "all"}`;
  const cached = await cacheGet<{
    byStatus: Array<{ status: string; count: number }>;
    lossByReason: Array<{ reason: string; count: number; amount: number }>;
    totalLoss: number;
  }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const [statusRows, lossRows] = await Promise.all([
    prisma.$queryRaw<Array<{ status: string | null; count: bigint }>>`
      SELECT "courierStatus" AS status, COUNT(*)::bigint AS count
      FROM "Order"
      WHERE "courierConsignmentId" IS NOT NULL AND "createdAt" >= ${since}
      GROUP BY "courierStatus"
      ORDER BY count DESC
    `,
    prisma.$queryRaw<Array<{ reason: string; count: bigint; amount: number }>>`
      SELECT reason::text AS reason, COUNT(*)::bigint AS count, COALESCE(SUM(amount), 0)::float AS amount
      FROM "CourierLossEvent"
      WHERE "createdAt" >= ${since}
      GROUP BY reason
      ORDER BY amount DESC
    `,
  ]);

  const lossByReason = lossRows.map((r) => ({ reason: r.reason, count: Number(r.count), amount: r.amount }));
  const result = {
    byStatus: statusRows.map((r) => ({ status: r.status ?? "unknown", count: Number(r.count) })),
    lossByReason,
    totalLoss: lossByReason.reduce((sum, r) => sum + r.amount, 0),
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

// ---------------------------------------------------------------------------
// Section 9 — Financial Analytics. Lifetime gross profit, inventory value, pending payments, and
// refund/return/cancelled rates already live on getExecutiveOverview (bi.service.ts) — reused
// there, not duplicated here. These add a windowed profit trend, a cost-of-discounts/refunds/
// courier-loss breakdown, and a clearly-labeled tax estimate (Order never snapshots tax per line,
// so this is StoreSetting's flat rate applied to windowed revenue, not a historical figure).
// ---------------------------------------------------------------------------

/** Daily revenue vs. estimated COGS (current cost price, same COALESCE(variant, product, 0)
 * convention as getInventoryTurnover/getHighestProfitProducts) vs. the resulting profit, zero-filled
 * across the window — the revenue-series idiom, extended with a cost side. */
export async function getProfitTrend(days = 30) {
  const cacheKey = `analytics:profit-trend:${days}`;
  const cached = await cacheGet<Array<{ date: string; revenue: number; cogs: number; profit: number }>>(cacheKey);
  if (cached) return cached;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const [revenueRows, cogsRows] = await Promise.all([
    prisma.$queryRaw<Array<{ day: Date; revenue: number }>>`
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COALESCE(SUM(total), 0)::float AS revenue
      FROM "Order"
      WHERE "createdAt" >= ${since} AND status != 'CANCELLED'
      GROUP BY day
    `,
    prisma.$queryRaw<Array<{ day: Date; cogs: number }>>`
      SELECT date_trunc('day', o."createdAt" AT TIME ZONE 'UTC') AS day,
        COALESCE(SUM(oi.quantity * COALESCE(pv."costPrice", p."costPrice", 0)), 0)::float AS cogs
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "ProductVariant" pv ON pv.id = oi."variantId"
      JOIN "Product" p ON p.id = pv."productId"
      WHERE o."createdAt" >= ${since} AND o.status != 'CANCELLED'
      GROUP BY day
    `,
  ]);

  const revenueByDay = new Map(revenueRows.map((r) => [r.day.toISOString().slice(0, 10), r.revenue]));
  const cogsByDay = new Map(cogsRows.map((r) => [r.day.toISOString().slice(0, 10), r.cogs]));

  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const revenue = revenueByDay.get(key) ?? 0;
    const cogs = cogsByDay.get(key) ?? 0;
    series.push({ date: key, revenue, cogs, profit: revenue - cogs });
  }

  await cacheSet(cacheKey, series, CACHE_TTL_SECONDS);
  return series;
}

/** The three "money leaving the business" figures that aren't plain revenue/COGS: refunded-order
 * value, discounts given away (coupon + bundle), and courier round-trip losses — summed for the
 * window so Financial Analytics can show a real cost line beyond COGS. */
export async function getFinancialCostBreakdown(days?: number) {
  const cacheKey = `analytics:financial-cost-breakdown:${days ?? "all"}`;
  const cached = await cacheGet<{ refundCost: number; discountCost: number; courierLossCost: number; courierLossCount: number }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const [orderRows, lossRows] = await Promise.all([
    prisma.$queryRaw<Array<{ refundCost: number; discountCost: number }>>`
      SELECT COALESCE(SUM(total) FILTER (WHERE "paymentStatus" = 'REFUNDED'), 0)::float AS "refundCost",
        COALESCE(SUM(discount + "bundleDiscount"), 0)::float AS "discountCost"
      FROM "Order"
      WHERE "createdAt" >= ${since} AND status != 'CANCELLED'
    `,
    prisma.$queryRaw<Array<{ amount: number; count: bigint }>>`
      SELECT COALESCE(SUM(amount), 0)::float AS amount, COUNT(*)::bigint AS count
      FROM "CourierLossEvent"
      WHERE "createdAt" >= ${since}
    `,
  ]);

  const order = orderRows[0] ?? { refundCost: 0, discountCost: 0 };
  const loss = lossRows[0] ?? { amount: 0, count: 0n };
  const result = { refundCost: order.refundCost, discountCost: order.discountCost, courierLossCost: loss.amount, courierLossCount: Number(loss.count) };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Estimated tax on windowed revenue from StoreSetting's flat `defaultTaxRate` — Order never
 * snapshots a tax amount per line, so this can only ever be a forward estimate against the
 * store's *current* rate, not a real historical figure; zero (with `taxEnabled: false`) when tax
 * collection isn't turned on. */
export async function getEstimatedTaxCollected(days?: number) {
  const cacheKey = `analytics:estimated-tax:${days ?? "all"}`;
  const cached = await cacheGet<{ taxEnabled: boolean; defaultTaxRatePct: number; estimatedTax: number; revenue: number }>(cacheKey);
  if (cached) return cached;

  const [settings, since] = [await getSettings(), daysAgoOrUndefined(days) ?? new Date(0)];
  const rows = await prisma.$queryRaw<Array<{ revenue: number }>>`
    SELECT COALESCE(SUM(total), 0)::float AS revenue
    FROM "Order"
    WHERE status != 'CANCELLED' AND "createdAt" >= ${since}
  `;
  const revenue = rows[0]?.revenue ?? 0;
  const rate = settings.taxEnabled && settings.defaultTaxRate ? Number(settings.defaultTaxRate) : 0;
  const result = { taxEnabled: settings.taxEnabled, defaultTaxRatePct: rate, estimatedTax: revenue * (rate / 100), revenue };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

// ---------------------------------------------------------------------------
// Section 10 — Inventory Intelligence. Turnover, low stock, and slow-moving already exist above
// (getInventoryTurnover, getLowStockVariants, getSlowMovingProducts) — these add a strict
// zero-sales "dead stock" view (distinct from merely slow) and a stock-movement-type summary.
// listStockMovements/getStockDiscrepancies (inventory.service.ts) already cover movement history
// and ledger-vs-actual drift, reused as-is on the frontend rather than rebuilt here.
// ---------------------------------------------------------------------------

/** Variants with stock on hand but *zero* sales in the window — stricter than "slow moving"
 * (lowest velocity), this is genuinely dead: capital sitting on a shelf with no signal it will
 * ever move. Ranked by how much inventory value is tied up. */
export async function getDeadStockReport(days = 90, limit = 10) {
  const cacheKey = `analytics:dead-stock:${days}:${limit}`;
  const cached = await cacheGet<
    Array<{ productId: string; name: string; variantId: string; sku: string; size: string; color: string; stock: number; tiedUpValue: number }>
  >(cacheKey);
  if (cached) return cached;

  const since = daysAgo(days);
  const rows = await prisma.$queryRaw<
    Array<{ productId: string; name: string; variantId: string; sku: string; size: string; color: string; stock: number; tiedUpValue: number }>
  >`
    WITH sold_variants AS (
      SELECT DISTINCT oi."variantId"
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o.status != 'CANCELLED' AND o."createdAt" >= ${since}
    )
    SELECT p.id AS "productId", p.name, pv.id AS "variantId", pv.sku, pv.size, pv.color, pv.stock,
      (pv.stock * COALESCE(pv."costPrice", p."costPrice", 0))::float AS "tiedUpValue"
    FROM "ProductVariant" pv
    JOIN "Product" p ON p.id = pv."productId"
    WHERE pv.stock > 0 AND p."deletedAt" IS NULL AND p."isActive" = true
      AND pv.id NOT IN (SELECT "variantId" FROM sold_variants)
    ORDER BY "tiedUpValue" DESC
    LIMIT ${limit}
  `;

  await cacheSet(cacheKey, rows, CACHE_TTL_SECONDS);
  return rows;
}

/** Stock-change volume by reason (order fulfillment, restock, manual adjustment, return) — the
 * aggregate view over what listStockMovements already shows row-by-row. */
export async function getStockMovementSummary(days?: number) {
  const cacheKey = `analytics:stock-movement-summary:${days ?? "all"}`;
  const cached = await cacheGet<Array<{ reason: string; movements: number; units: number }>>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ reason: string; movements: bigint; units: bigint }>>`
    SELECT reason::text AS reason, COUNT(*)::bigint AS movements, COALESCE(SUM(ABS(change)), 0)::bigint AS units
    FROM "StockMovement"
    WHERE "createdAt" >= ${since}
    GROUP BY reason
    ORDER BY movements DESC
  `;

  const result = rows.map((r) => ({ reason: r.reason, movements: Number(r.movements), units: Number(r.units) }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

// ---------------------------------------------------------------------------
// Section 11 — Operational Analytics. Order fulfillment speed (from OrderStatusHistory's
// append-only timeline) and admin activity (from AuditLog, already recorded on every admin
// mutation). API request/error-rate tracking is explicitly out of scope — no request or error log
// table exists anywhere in the schema; that would need new instrumentation, not a report.
// ---------------------------------------------------------------------------

/** Average hours from order placed -> first shipped -> first delivered, over delivered orders in
 * the window. Uses the first OrderStatusHistory row for each status (an order can revisit a
 * status, e.g. after a courier hiccup — "first" is when it *initially* got there). */
export async function getOrderFulfillmentTime(days?: number) {
  const cacheKey = `analytics:fulfillment-time:${days ?? "all"}`;
  const cached = await cacheGet<{ avgHoursToShip: number | null; avgHoursShipToDeliver: number | null; avgHoursToDeliver: number | null; deliveredOrders: number }>(
    cacheKey,
  );
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<
    Array<{ avgHoursToShip: number | null; avgHoursShipToDeliver: number | null; avgHoursToDeliver: number | null; deliveredOrders: bigint }>
  >`
    WITH first_shipped AS (
      SELECT "orderId", MIN("createdAt") AS "shippedAt" FROM "OrderStatusHistory" WHERE status = 'SHIPPED' GROUP BY "orderId"
    ),
    first_delivered AS (
      SELECT "orderId", MIN("createdAt") AS "deliveredAt" FROM "OrderStatusHistory" WHERE status = 'DELIVERED' GROUP BY "orderId"
    )
    SELECT
      AVG(EXTRACT(EPOCH FROM (fs."shippedAt" - o."createdAt")) / 3600)::float AS "avgHoursToShip",
      AVG(EXTRACT(EPOCH FROM (fd."deliveredAt" - fs."shippedAt")) / 3600)::float AS "avgHoursShipToDeliver",
      AVG(EXTRACT(EPOCH FROM (fd."deliveredAt" - o."createdAt")) / 3600)::float AS "avgHoursToDeliver",
      COUNT(fd."orderId")::bigint AS "deliveredOrders"
    FROM "Order" o
    LEFT JOIN first_shipped fs ON fs."orderId" = o.id
    LEFT JOIN first_delivered fd ON fd."orderId" = o.id
    WHERE o."createdAt" >= ${since} AND o.status != 'CANCELLED'
  `;

  const row = rows[0]!;
  const result = {
    avgHoursToShip: row.avgHoursToShip,
    avgHoursShipToDeliver: row.avgHoursShipToDeliver,
    avgHoursToDeliver: row.avgHoursToDeliver,
    deliveredOrders: Number(row.deliveredOrders),
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Admin action volume, by admin and by action type — straight off the existing AuditLog table
 * (already written on every admin mutation), never previously aggregated for a report. */
export async function getAdminActivitySummary(days?: number, limit = 10) {
  const cacheKey = `analytics:admin-activity:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<{ byAdmin: Array<{ id: string; name: string; actions: number }>; byAction: Array<{ action: string; count: number }> }>(
    cacheKey,
  );
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const [adminRows, actionRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string; actions: bigint }>>`
      SELECT a.id, a.name, COUNT(*)::bigint AS actions
      FROM "AuditLog" al
      JOIN "AdminUser" a ON a.id = al."adminId"
      WHERE al."createdAt" >= ${since}
      GROUP BY a.id, a.name
      ORDER BY actions DESC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Array<{ action: string; count: bigint }>>`
      SELECT action, COUNT(*)::bigint AS count
      FROM "AuditLog"
      WHERE "createdAt" >= ${since}
      GROUP BY action
      ORDER BY count DESC
      LIMIT ${limit}
    `,
  ]);

  const result = {
    byAdmin: adminRows.map((r) => ({ id: r.id, name: r.name, actions: Number(r.actions) })),
    byAction: actionRows.map((r) => ({ action: r.action, count: Number(r.count) })),
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

// ---------------------------------------------------------------------------
// Section 12 — User Behavior. Most-wishlisted and general engagement already exist above
// (getMostWishlisted, getEngagementSummary) — these add whether wishlisting actually leads to a
// purchase, review-submission/moderation behavior, and contact-form feedback volume. Session
// recordings/heatmaps are out of scope — no schema captures pointer/scroll traces beyond the
// aggregate scrollDepthPct/clickCount already used in getEngagementSummary.
// ---------------------------------------------------------------------------

/** Of products wishlisted in the window, what share were later bought by that same customer —
 * "later" meaning any of their orders placed on/after the wishlist date, matched by product (not
 * variant, since a customer may buy a different size/color than the one they wishlisted). */
export async function getWishlistConversionRate(days?: number) {
  const cacheKey = `analytics:wishlist-conversion:${days ?? "all"}`;
  const cached = await cacheGet<{ totalWishlisted: number; converted: number; conversionRatePct: number }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ totalWishlisted: bigint; converted: bigint }>>`
    WITH wishlisted AS (
      SELECT id, "customerId", "productId", "createdAt" FROM "WishlistItem" WHERE "createdAt" >= ${since}
    ),
    converted AS (
      SELECT DISTINCT w.id
      FROM wishlisted w
      JOIN "Order" o ON o."customerId" = w."customerId" AND o."createdAt" >= w."createdAt" AND o.status != 'CANCELLED'
      JOIN "OrderItem" oi ON oi."orderId" = o.id
      JOIN "ProductVariant" pv ON pv.id = oi."variantId" AND pv."productId" = w."productId"
    )
    SELECT (SELECT COUNT(*) FROM wishlisted)::bigint AS "totalWishlisted", (SELECT COUNT(*) FROM converted)::bigint AS converted
  `;

  const row = rows[0]!;
  const totalWishlisted = Number(row.totalWishlisted);
  const converted = Number(row.converted);
  const result = { totalWishlisted, converted, conversionRatePct: totalWishlisted > 0 ? (converted / totalWishlisted) * 100 : 0 };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Rating distribution + moderation-status breakdown for submitted reviews in the window. */
export async function getReviewBehaviorStats(days?: number) {
  const cacheKey = `analytics:review-behavior:${days ?? "all"}`;
  const cached = await cacheGet<{
    byRating: Array<{ rating: number; count: number }>;
    byStatus: Array<{ status: string; count: number; verified: number }>;
    avgRating: number;
  }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const [ratingRows, statusRows] = await Promise.all([
    prisma.$queryRaw<Array<{ rating: number; count: bigint }>>`
      SELECT rating, COUNT(*)::bigint AS count FROM "ProductReview" WHERE "createdAt" >= ${since} GROUP BY rating ORDER BY rating ASC
    `,
    prisma.$queryRaw<Array<{ status: string; count: bigint; verified: bigint }>>`
      SELECT status::text AS status, COUNT(*)::bigint AS count, COUNT(*) FILTER (WHERE "isVerifiedPurchase")::bigint AS verified
      FROM "ProductReview"
      WHERE "createdAt" >= ${since}
      GROUP BY status
    `,
  ]);

  const byRating = ratingRows.map((r) => ({ rating: r.rating, count: Number(r.count) }));
  const totalRatings = byRating.reduce((sum, r) => sum + r.count, 0);
  const weightedSum = byRating.reduce((sum, r) => sum + r.rating * r.count, 0);
  const result = {
    byRating,
    byStatus: statusRows.map((r) => ({ status: r.status, count: Number(r.count), verified: Number(r.verified) })),
    avgRating: totalRatings > 0 ? weightedSum / totalRatings : 0,
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Contact-form submission volume and how much of it has actually been read by an admin. */
export async function getFeedbackVolume(days?: number) {
  const cacheKey = `analytics:feedback-volume:${days ?? "all"}`;
  const cached = await cacheGet<{ total: number; read: number; unread: number }>(cacheKey);
  if (cached) return cached;

  const since = daysAgoOrUndefined(days) ?? new Date(0);
  const rows = await prisma.$queryRaw<Array<{ total: bigint; read: bigint }>>`
    SELECT COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE "readAt" IS NOT NULL)::bigint AS read
    FROM "Feedback"
    WHERE "createdAt" >= ${since}
  `;

  const row = rows[0]!;
  const total = Number(row.total);
  const read = Number(row.read);
  const result = { total, read, unread: total - read };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

// ---------------------------------------------------------------------------
// Section 14 — Lifetime Data. Almost entirely composition: getExecutiveOverview (bi.service.ts),
// getCohortRetention, getCustomerRfmTable, and getPurchaseFrequencyDistribution above already
// cover lifetime value/CLV, cohort survival, and RFM/frequency — this adds the one genuinely new
// piece, a year-over-year trend, which none of those provide.
// ---------------------------------------------------------------------------

/** Orders and revenue grouped by calendar year, Asia/Dhaka local, all-time. */
export async function getLifetimeYearlyTrend() {
  const cacheKey = "analytics:lifetime-yearly-trend";
  const cached = await cacheGet<Array<{ year: number; orders: number; revenue: number }>>(cacheKey);
  if (cached) return cached;

  const rows = await prisma.$queryRaw<Array<{ year: number; orders: bigint; revenue: number }>>`
    SELECT EXTRACT(YEAR FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')::int AS year,
      COUNT(*)::bigint AS orders, COALESCE(SUM(total), 0)::float AS revenue
    FROM "Order"
    WHERE status != 'CANCELLED'
    GROUP BY year
    ORDER BY year ASC
  `;

  const result = rows.map((r) => ({ year: r.year, orders: Number(r.orders), revenue: r.revenue }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}
