import geoip from "geoip-lite";
import { enumerateBuckets, previousRange, type TrackPageViewInput, type TrackPageExitInput, type TrackFunnelEventInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { ABANDONMENT_THRESHOLD_MS } from "../cart/cart.service";
import { loadCustomersWithComputedFields, sendBulkSmsToCustomers } from "../customers/customer.service";
import { AppError } from "../../lib/app-error";
import { resolveLegacyWindow, resolveStoreRange, storeContext, utcInstant } from "../../domain/metrics/store-time";
import { saleOrderSql } from "../../domain/metrics/sale-order";
import { computeMetrics } from "../../domain/metrics/metrics.service";
import { getCustomerInsights } from "./sales-analytics.service";

const CACHE_TTL_SECONDS = 300;

// Sales, product, customer, promotion and financial reports are cuts of the metrics SSOT (Phase 5,
// docs/METRICS_REGISTRY.md) — implemented in sales-analytics.service.ts, re-exported here so every caller keeps one import.
export {
  getRevenueSeries,
  getOrderStatusCounts,
  getTopProducts,
  getLowStockVariants,
  getDashboardSummary,
  getCustomerInsights,
  getCohortRetention,
  getTopCategories,
  getTopBrands,
  getSlowMovingProducts,
  getBestSellingPrediction,
  getDemandForecast,
  getCampaignPerformance,
  getProductConversionRates,
  getHighestProfitProducts,
  getProductRiskMetrics,
  getFrequentlyBoughtTogetherPairs,
  getProductSalesHeatmap,
  getVariantPerformance,
  getSizeColorPerformance,
  getInventoryTurnover,
  getFavoritePaymentMethod,
  getPurchaseTimeDistribution,
  getCustomerLocationBreakdown,
  getCouponEffectiveness,
  getBundlePerformance,
  getFlashSalePerformance,
  getDiscountUsageBreakdown,
  getProfitTrend,
  getFinancialCostBreakdown,
  getEstimatedTaxCollected,
  getDeadStockReport,
  getOrderFulfillmentTime,
  getLifetimeYearlyTrend,
  type ProductSalesHeatmap,
} from "./sales-analytics.service";
/** Every window below resolves through the canonical business-time mechanism (docs/METRICS_REGISTRY.md §1): "last N
 * days" = N business days in the store timezone ending today; a picker's dateFrom/dateTo = the business dates they fall
 * on, inclusive; undefined = lifetime. Ranges are half-open [since, until), and every bound instant reaches SQL through
 * `utcInstant` (raw comparisons against the naive-UTC columns were 6 h off — PHASE_5_METRICS_AUDIT §2). */
interface ResolvedDateRange {
  since: Date;
  until: Date;
  cacheKeyPart: string;
  timezone: string;
}

async function resolveDateRange(days: number | undefined, dateFrom?: Date, dateTo?: Date): Promise<ResolvedDateRange> {
  const r = await resolveLegacyWindow(days, dateFrom, dateTo);
  return { since: r.startUtc, until: r.endUtc, timezone: r.timezone, cacheKeyPart: `${r.timezone}:${r.startUtc.toISOString()}:${r.endUtc.toISOString()}` };
}

/** Lower bound of a "last N days" window (epoch for lifetime). */
async function windowStart(days: number | undefined): Promise<Date> {
  return (await resolveLegacyWindow(days)).startUtc;
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

/** Daily unique-visitor + pageview counts for the last N days, zero-filled — the visitor-side
 * counterpart to getRevenueSeries. "Visitor" here means a distinct PageView.sessionId, the closest
 * this anonymous, cookie-based system gets to a person. */
// Zero-fill loops (this one and getRevenueSeries) emit one row per day, so an unbounded custom
// range would generate an unbounded response — clamp to just over a year regardless of how wide a
// dateFrom/dateTo the caller picks.
const MAX_SERIES_DAYS = 400;

export async function getVisitorSeries(days = 30, dateFrom?: Date, dateTo?: Date) {
  const window = await resolveLegacyWindow(days, dateFrom, dateTo);
  const cacheKey = `analytics:visitors:${window.timezone}:${window.startUtc.toISOString()}:${window.endUtc.toISOString()}`;
  const cached = await cacheGet<Array<{ date: string; visitors: number; pageViews: number }>>(cacheKey);
  if (cached) return cached;

  const rows = await prisma.$queryRaw<Array<{ day: string; visitors: bigint; pageViews: bigint }>>`
    SELECT to_char((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${window.timezone}), 'YYYY-MM-DD') AS day,
           COUNT(DISTINCT "sessionId")::bigint AS visitors,
           COUNT(*)::bigint AS "pageViews"
    FROM "PageView"
    WHERE "createdAt" >= ${utcInstant(window.startUtc)} AND "createdAt" < ${utcInstant(window.endUtc)}
    GROUP BY day
  `;
  const byDay = new Map(rows.map((r) => [r.day, { visitors: Number(r.visitors), pageViews: Number(r.pageViews) }]));
  // A lifetime window starts at the first day with traffic; any window is capped at MAX_SERIES_DAYS buckets.
  const firstDay = window.preset === "lifetime" ? ([...byDay.keys()].sort()[0] ?? window.to) : window.from;
  const keys = enumerateBuckets({ ...window, from: firstDay }, "day", Number.MAX_SAFE_INTEGER).slice(-MAX_SERIES_DAYS);
  const series = keys.map((date) => ({ date, visitors: byDay.get(date)?.visitors ?? 0, pageViews: byDay.get(date)?.pageViews ?? 0 }));

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

  const since = await windowStart(days);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; views: bigint }>>`
    SELECT p.id, p.name, p.slug, COUNT(*)::bigint AS views
    FROM "ProductViewLog" v
    JOIN "Product" p ON p.id = v."productId"
    WHERE v."createdAt" >= ${utcInstant(since)}
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
  const recent = await resolveStoreRange({ preset: "last_7_days" });
  const prior = previousRange(recent);
  const cacheKey = `analytics:trending-products:${limit}:${recent.timezone}:${recent.from}`;
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
      WHERE "createdAt" >= ${utcInstant(recent.startUtc)}
      GROUP BY "productId"
    ),
    prior AS (
      SELECT "productId", COUNT(*)::bigint AS views
      FROM "ProductViewLog"
      WHERE "createdAt" >= ${utcInstant(prior.startUtc)} AND "createdAt" < ${utcInstant(prior.endUtc)}
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

  const since = await windowStart(days);
  const [topQueries, totals] = await Promise.all([
    prisma.$queryRaw<Array<{ query: string; count: bigint }>>`
      SELECT query, COUNT(*)::bigint AS count
      FROM "SearchLog"
      WHERE "createdAt" >= ${utcInstant(since)}
      GROUP BY query
      ORDER BY count DESC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Array<{ total: bigint; zeroResult: bigint }>>`
      SELECT COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE "resultCount" = 0)::bigint AS "zeroResult"
      FROM "SearchLog"
      WHERE "createdAt" >= ${utcInstant(since)}
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
  const recent = await resolveStoreRange({ preset: "last_7_days" });
  const prior = previousRange(recent);
  const cacheKey = `analytics:search-trends:${limit}:${recent.timezone}:${recent.from}`;
  const cached = await cacheGet<Array<{ query: string; recentCount: number; priorCount: number; growthPct: number }>>(cacheKey);
  if (cached) return cached;

  const rows = await prisma.$queryRaw<Array<{ query: string; recentCount: bigint; priorCount: bigint }>>`
    WITH recent AS (
      SELECT query, COUNT(*)::bigint AS count
      FROM "SearchLog"
      WHERE "createdAt" >= ${utcInstant(recent.startUtc)}
      GROUP BY query
    ),
    prior AS (
      SELECT query, COUNT(*)::bigint AS count
      FROM "SearchLog"
      WHERE "createdAt" >= ${utcInstant(prior.startUtc)} AND "createdAt" < ${utcInstant(prior.endUtc)}
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

  const since = await windowStart(days);
  const rows = await prisma.$queryRaw<Array<{ query: string; count: bigint; lastSearchedAt: Date; suggestion: string | null }>>`
    SELECT
      query,
      COUNT(*)::bigint AS count,
      MAX("createdAt") AS "lastSearchedAt",
      (array_agg("suggestion") FILTER (WHERE "suggestion" IS NOT NULL))[1] AS suggestion
    FROM "SearchLog"
    WHERE "resultCount" = 0 AND "createdAt" >= ${utcInstant(since)}
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

  const since = await windowStart(days);
  const rows = await prisma.$queryRaw<Array<{ searchSessions: bigint; purchasedSessions: bigint; exitedSessions: bigint }>>`
    WITH searched_sessions AS (
      SELECT DISTINCT "sessionId" FROM "SearchLog" WHERE "sessionId" IS NOT NULL AND "createdAt" >= ${utcInstant(since)}
    ),
    converted AS (
      SELECT DISTINCT o."sessionId"
      FROM "Order" o
      JOIN searched_sessions s ON s."sessionId" = o."sessionId"
      WHERE ${saleOrderSql("o")}
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

  const since = await windowStart(days);
  const rows = await prisma.$queryRaw<Array<{ device: string; sessions: bigint }>>`
    WITH search_sessions AS (
      SELECT DISTINCT "sessionId" FROM "SearchLog" WHERE "sessionId" IS NOT NULL AND "createdAt" >= ${utcInstant(since)}
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
      SELECT DISTINCT "sessionId" FROM "SearchLog" WHERE "sessionId" IS NOT NULL AND "createdAt" >= ${utcInstant(since)}
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

  const since = await windowStart(days);
  const rows = await prisma.$queryRaw<Array<{ city: string; sessions: bigint }>>`
    WITH search_sessions AS (
      SELECT DISTINCT "sessionId" FROM "SearchLog" WHERE "sessionId" IS NOT NULL AND "createdAt" >= ${utcInstant(since)}
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
    WHERE c."updatedAt" <= ${utcInstant(cutoff)}
  `;

  const result = {
    cartCount: Number(rows[0]?.cartCount ?? 0),
    potentialRevenue: rows[0]?.potentialRevenue ?? 0,
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

export interface AbandonedCartRow {
  cartId: string;
  customerId: string;
  name: string;
  phone: string | null;
  smsMarketingOptIn: boolean;
  /** Has a phone and opted in to marketing SMS — the only carts a reminder may go to. */
  reachable: boolean;
  itemCount: number;
  value: number;
  firstItemName: string | null;
  updatedAt: Date;
  reminderSentAt: Date | null;
}

/** The carts behind getCartAbandonmentSummary's count — same threshold, same pricing (variant price, else base price) —
 * newest first, with who they belong to and whether that customer may be sent a reminder. Not cached: it's a work list. */
export async function listAbandonedCarts(limit = 50): Promise<AbandonedCartRow[]> {
  const cutoff = new Date(Date.now() - ABANDONMENT_THRESHOLD_MS);
  const carts = await prisma.cart.findMany({
    where: { updatedAt: { lte: cutoff }, items: { some: {} } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      updatedAt: true,
      reminderSentAt: true,
      customer: { select: { id: true, name: true, phone: true, smsMarketingOptIn: true } },
      items: {
        orderBy: { updatedAt: "desc" },
        select: { quantity: true, variant: { select: { price: true, product: { select: { name: true, basePrice: true } } } } },
      },
    },
  });

  return carts.map((c) => ({
    cartId: c.id,
    customerId: c.customer.id,
    name: c.customer.name,
    phone: c.customer.phone,
    smsMarketingOptIn: c.customer.smsMarketingOptIn,
    reachable: Boolean(c.customer.phone) && c.customer.smsMarketingOptIn,
    itemCount: c.items.reduce((n, i) => n + i.quantity, 0),
    value: c.items.reduce((sum, i) => sum + i.quantity * Number(i.variant.price ?? i.variant.product.basePrice), 0),
    firstItemName: c.items[0]?.variant.product.name ?? null,
    updatedAt: c.updatedAt,
    reminderSentAt: c.reminderSentAt,
  }));
}

/**
 * Sends a cart-recovery SMS to the chosen customers — but only those whose cart is still abandoned and who have a phone
 * and SMS marketing opt-in (a reminder is marketing, unlike the CRM's ad-hoc bulk message). Stamps the carts'
 * reminderSentAt so the list shows who was already nudged.
 */
export async function remindAbandonedCarts(customerIds: string[], body: string) {
  const cutoff = new Date(Date.now() - ABANDONMENT_THRESHOLD_MS);
  const carts = await prisma.cart.findMany({
    where: {
      customerId: { in: customerIds },
      updatedAt: { lte: cutoff },
      items: { some: {} },
      customer: { smsMarketingOptIn: true, phone: { not: null } },
    },
    select: { id: true, customerId: true },
  });
  if (carts.length === 0) {
    throw AppError.badRequest("None of the selected customers can be messaged — a reminder needs a phone number and SMS marketing opt-in");
  }

  const result = await sendBulkSmsToCustomers(
    carts.map((c) => c.customerId),
    body,
  );
  // Raw UPDATE on purpose: Prisma's @updatedAt would bump Cart.updatedAt, which is the abandonment clock itself — a
  // reminded cart would vanish from the abandoned list (and the summary) as if the customer had come back.
  // Only stamped when the provider accepted at least one message — a fully failed send (provider down, not configured)
  // must leave the carts looking un-reminded so the admin can retry.
  if (result.sent > 0) {
    const cartIds = carts.map((c) => c.id);
    await prisma.$executeRaw`UPDATE "Cart" SET "reminderSentAt" = ${utcInstant(new Date())} WHERE id = ANY(${cartIds}::text[])`;
  }

  return { ...result, skipped: result.skipped + (customerIds.length - carts.length) };
}

/** Conversion rate is the registry's `conversion_rate` (D25: orders placed from a storefront session ÷ sessions), so
 * Home, Analytics and AI read one definition; `convertedSessions` (distinct sessions with an order) stays as a funnel
 * step. Bounce rate = sessions with exactly one pageview ÷ total sessions. Both require the PageView beacon to actually be firing —
 * return zeros (not an error) when there's no pageview data yet for the window. */
export async function getConversionFunnel(days = 30, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:funnel:${range.cacheKeyPart}`;
  const cached = await cacheGet<{ totalSessions: number; bouncedSessions: number; convertedSessions: number; conversionRate: number; bounceRate: number }>(
    cacheKey,
  );
  if (cached) return cached;

  const { since, until } = range;
  const conversion = await computeMetrics({ metrics: ["conversion_rate"], range: await resolveLegacyWindow(days, dateFrom, dateTo) });
  const rows = await prisma.$queryRaw<Array<{ totalSessions: bigint; bouncedSessions: bigint; convertedSessions: bigint }>>`
    WITH sessions AS (
      SELECT "sessionId", COUNT(*) AS views
      FROM "PageView"
      WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
      GROUP BY "sessionId"
    ),
    converted AS (
      SELECT DISTINCT "sessionId"
      FROM "Order" o
      WHERE o."sessionId" IS NOT NULL AND o."createdAt" >= ${utcInstant(since)} AND o."createdAt" < ${utcInstant(until)} AND ${saleOrderSql("o")}
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
    conversionRate: conversion.metrics.conversion_rate!.value * 100,
    bounceRate: totalSessions > 0 ? (bouncedSessions / totalSessions) * 100 : 0,
  };
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

/** Sessions grouped by first-touch source: an explicit utm_source if present, else the referring
 * site's domain, else "Direct" (no referrer — typed URL, bookmark, or an app with no referrer). */
export async function getTrafficSources(days = 30, limit = 10, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:traffic-sources:${range.cacheKeyPart}:${limit}`;
  const cached = await cacheGet<Array<{ source: string; sessions: number }>>(cacheKey);
  if (cached) return cached;

  const { since, until } = range;
  const rows = await prisma.$queryRaw<Array<{ source: string; sessions: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", referrer, "utmSource"
      FROM "PageView"
      WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
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
    WHERE "createdAt" >= ${utcInstant(since)}
  `;

  const result = Number(rows[0]?.count ?? 0);
  await cacheSet(cacheKey, result, 15);
  return result;
}

/** Pageview counts bucketed by day-of-week × hour-of-day, in the store timezone (StoreSetting.timezone)
 * rather than UTC — "9pm is the busiest hour" is only actionable in wall-clock time.
 * Zero-filled across all 7×24 = 168 cells so the heatmap has no gaps. */
export async function getTrafficHeatmap(days = 30) {
  const { timezone: tz } = await storeContext();
  const cacheKey = `analytics:traffic-heatmap:${days}:${tz}`;
  const cached = await cacheGet<Array<{ dow: number; hour: number; count: number }>>(cacheKey);
  if (cached) return cached;

  const since = await windowStart(days);
  const rows = await prisma.$queryRaw<Array<{ dow: number; hour: number; count: bigint }>>`
    SELECT
      EXTRACT(DOW FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::int AS dow,
      EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::int AS hour,
      COUNT(*)::bigint AS count
    FROM "PageView"
    WHERE "createdAt" >= ${utcInstant(since)}
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
export async function getDeviceBreakdown(days = 30, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:devices:${range.cacheKeyPart}`;
  const cached = await cacheGet<Array<{ device: string; sessions: number }>>(cacheKey);
  if (cached) return cached;

  const { since, until } = range;
  const rows = await prisma.$queryRaw<Array<{ device: string; sessions: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", "userAgent"
      FROM "PageView"
      WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
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
export async function getBrowserBreakdown(days = 30, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:browsers:${range.cacheKeyPart}`;
  const cached = await cacheGet<Array<{ browser: string; sessions: number }>>(cacheKey);
  if (cached) return cached;

  const { since, until } = range;
  const rows = await prisma.$queryRaw<Array<{ browser: string; sessions: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", "userAgent"
      FROM "PageView"
      WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
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
export async function getOsBreakdown(days?: number, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:os:${range.cacheKeyPart}`;
  const cached = await cacheGet<Array<{ os: string; sessions: number }>>(cacheKey);
  if (cached) return cached;

  const { since, until } = range;
  const rows = await prisma.$queryRaw<Array<{ os: string; sessions: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", "userAgent"
      FROM "PageView"
      WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
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
export async function getLanguageBreakdown(days?: number, limit = 10, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:languages:${range.cacheKeyPart}:${limit}`;
  const cached = await cacheGet<Array<{ language: string; sessions: number }>>(cacheKey);
  if (cached) return cached;

  const { since, until } = range;
  const rows = await prisma.$queryRaw<Array<{ language: string; sessions: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", "language"
      FROM "PageView"
      WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
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
export async function getGeoBreakdown(days?: number, limit = 10, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:geo:${range.cacheKeyPart}:${limit}`;
  const cached = await cacheGet<{
    countries: Array<{ countryCode: string; sessions: number }>;
    regions: Array<{ region: string; sessions: number }>;
    cities: Array<{ city: string; sessions: number }>;
  }>(cacheKey);
  if (cached) return cached;

  const { since, until } = range;
  const [countryRows, regionRows, cityRows] = await Promise.all([
    prisma.$queryRaw<Array<{ countryCode: string; sessions: bigint }>>`
      WITH first_touch AS (
        SELECT DISTINCT ON ("sessionId") "sessionId", "countryCode"
        FROM "PageView"
        WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)} AND "countryCode" IS NOT NULL
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
        WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)} AND "region" IS NOT NULL
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
        WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)} AND "city" IS NOT NULL AND "city" != ''
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
export async function getLoggedInVsGuest(days?: number, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:logged-in-vs-guest:${range.cacheKeyPart}`;
  const cached = await cacheGet<{ loggedIn: number; guest: number }>(cacheKey);
  if (cached) return cached;

  const { since, until } = range;
  const rows = await prisma.$queryRaw<Array<{ loggedIn: bigint; guest: bigint }>>`
    WITH first_touch AS (
      SELECT DISTINCT ON ("sessionId") "sessionId", "isLoggedIn"
      FROM "PageView"
      WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
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
export async function getEntryExitPages(days?: number, limit = 10, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:entry-exit-pages:${range.cacheKeyPart}:${limit}`;
  const cached = await cacheGet<{
    entryPages: Array<{ path: string; sessions: number }>;
    exitPages: Array<{ path: string; sessions: number }>;
  }>(cacheKey);
  if (cached) return cached;

  const { since, until } = range;
  const [entryRows, exitRows] = await Promise.all([
    prisma.$queryRaw<Array<{ path: string; sessions: bigint }>>`
      WITH first_touch AS (
        SELECT DISTINCT ON ("sessionId") "sessionId", path
        FROM "PageView"
        WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
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
        WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
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
export async function getEngagementSummary(days?: number, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:engagement:${range.cacheKeyPart}`;
  const cached = await cacheGet<{
    avgTimePerPageMs: number;
    avgScrollDepthPct: number;
    avgClicksPerPage: number;
    avgSessionDurationMs: number;
    avgPagesPerSession: number;
  }>(cacheKey);
  if (cached) return cached;

  const { since, until } = range;
  const [pageRows, sessionRows] = await Promise.all([
    prisma.$queryRaw<Array<{ avgDuration: number; avgScroll: number; avgClicks: number }>>`
      SELECT
        COALESCE(AVG("durationMs"), 0)::float AS "avgDuration",
        COALESCE(AVG("scrollDepthPct"), 0)::float AS "avgScroll",
        COALESCE(AVG("clickCount"), 0)::float AS "avgClicks"
      FROM "PageView"
      WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)} AND "durationMs" IS NOT NULL
    `,
    prisma.$queryRaw<Array<{ avgSessionDuration: number; avgPages: number }>>`
      WITH per_session AS (
        SELECT "sessionId", COALESCE(SUM("durationMs"), 0) AS total_duration, COUNT(*) AS pages
        FROM "PageView"
        WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
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

/** Histogram of how many distinct calendar days (lifetime, store timezone) each known visitor has been
 * active on — "how sticky is the audience", not windowed since frequency is inherently a lifetime
 * measure. Visitors with no visitorId (pre-Phase-2 traffic) can't be bucketed and are excluded. */
export async function getReturningVisitorFrequency() {
  const { timezone: tz } = await storeContext();
  const cacheKey = `analytics:returning-visitor-frequency:${tz}`;
  const cached = await cacheGet<Array<{ bucket: string; visitors: number }>>(cacheKey);
  if (cached) return cached;

  const rows = await prisma.$queryRaw<Array<{ bucket: string; visitors: bigint }>>`
    WITH per_visitor_days AS (
      SELECT "visitorId", COUNT(DISTINCT date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})) AS "activeDays"
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

  const since = await windowStart(days);

  const [pageRows, eventRows, orderRows, customerInsights] = await Promise.all([
    prisma.$queryRaw<Array<{ landing: bigint; category: bigint; product: bigint; checkout: bigint; success: bigint }>>`
      SELECT
        COUNT(DISTINCT "sessionId")::bigint AS landing,
        COUNT(DISTINCT "sessionId") FILTER (WHERE path LIKE '/category/%')::bigint AS category,
        COUNT(DISTINCT "sessionId") FILTER (WHERE path LIKE '/product/%')::bigint AS product,
        COUNT(DISTINCT "sessionId") FILTER (WHERE path = '/checkout')::bigint AS checkout,
        COUNT(DISTINCT "sessionId") FILTER (WHERE path LIKE '/order-confirmation/%')::bigint AS success
      FROM "PageView"
      WHERE "createdAt" >= ${utcInstant(since)}
    `,
    prisma.$queryRaw<Array<{ variant: bigint; addToCart: bigint }>>`
      SELECT
        COUNT(DISTINCT "sessionId") FILTER (WHERE type = 'VARIANT_SELECTED')::bigint AS variant,
        COUNT(DISTINCT "sessionId") FILTER (WHERE type = 'ADD_TO_CART')::bigint AS "addToCart"
      FROM "FunnelEvent"
      WHERE "createdAt" >= ${utcInstant(since)}
    `,
    prisma.$queryRaw<Array<{ payment: bigint }>>`
      SELECT COUNT(DISTINCT "sessionId")::bigint AS payment
      FROM "Order"
      WHERE "deletedAt" IS NULL AND "sessionId" IS NOT NULL AND "createdAt" >= ${utcInstant(since)}
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

  const since = await windowStart(days);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; count: bigint }>>`
    SELECT p.id, p.name, p.slug, COUNT(*)::bigint AS count
    FROM "FunnelEvent" fe
    JOIN "Product" p ON p.id = fe."productId"
    WHERE fe.type = 'ADD_TO_CART' AND fe."createdAt" >= ${utcInstant(since)}
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

  const since = await windowStart(days);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; count: bigint }>>`
    SELECT p.id, p.name, p.slug, COUNT(*)::bigint AS count
    FROM "FunnelEvent" fe
    JOIN "Product" p ON p.id = fe."productId"
    WHERE fe.type = 'REMOVE_FROM_CART' AND fe."createdAt" >= ${utcInstant(since)}
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

// ---------------------------------------------------------------------------
// Section 7 — Marketing Intelligence. Traffic-source/UTM attribution and campaign performance
// already exist above (getTrafficSources, getCampaignPerformance, Phase 2) — these are the
// remaining marketing levers: coupons, bundles, flash sales, bulk email/SMS/push campaigns, and
// the reward-points ledger. No referral program exists anywhere in the schema, so it isn't here.
// ---------------------------------------------------------------------------

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

/** Return/exchange request volume by type + status, plus the most common reasons — `reason` is
 * free text (customers type it), so only exact repeats group together; it's a signal, not a
 * clustered taxonomy. */
export async function getReturnRequestAnalytics(days?: number, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:return-request-analytics:${range.cacheKeyPart}`;
  const cached = await cacheGet<{
    byTypeStatus: Array<{ type: string; status: string; count: number }>;
    topReasons: Array<{ reason: string; count: number }>;
  }>(cacheKey);
  if (cached) return cached;

  const { since, until } = range;
  const [typeStatusRows, reasonRows] = await Promise.all([
    prisma.$queryRaw<Array<{ type: string; status: string; count: bigint }>>`
      SELECT type::text AS type, status::text AS status, COUNT(*)::bigint AS count
      FROM "ReturnRequest"
      WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
      GROUP BY type, status
      ORDER BY count DESC
    `,
    prisma.$queryRaw<Array<{ reason: string; count: bigint }>>`
      SELECT reason, COUNT(*)::bigint AS count
      FROM "ReturnRequest"
      WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
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
export async function getCourierPerformance(days?: number, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveDateRange(days, dateFrom, dateTo);
  const cacheKey = `analytics:courier-performance:${range.cacheKeyPart}`;
  const cached = await cacheGet<{
    byStatus: Array<{ status: string; count: number }>;
    lossByReason: Array<{ reason: string; count: number; amount: number }>;
    totalLoss: number;
  }>(cacheKey);
  if (cached) return cached;

  const { since, until } = range;
  const [statusRows, lossRows] = await Promise.all([
    prisma.$queryRaw<Array<{ status: string | null; count: bigint }>>`
      SELECT "courierStatus" AS status, COUNT(*)::bigint AS count
      FROM "Order"
      WHERE "deletedAt" IS NULL AND "courierConsignmentId" IS NOT NULL AND "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
      GROUP BY "courierStatus"
      ORDER BY count DESC
    `,
    prisma.$queryRaw<Array<{ reason: string; count: bigint; amount: number }>>`
      SELECT reason::text AS reason, COUNT(*)::bigint AS count, COALESCE(SUM(amount), 0)::float AS amount
      FROM "CourierLossEvent"
      WHERE "createdAt" >= ${utcInstant(since)} AND "createdAt" < ${utcInstant(until)}
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

// ---------------------------------------------------------------------------
// Section 10 — Inventory Intelligence. Turnover, low stock, and slow-moving already exist above
// (getInventoryTurnover, getLowStockVariants, getSlowMovingProducts) — these add a strict
// zero-sales "dead stock" view (distinct from merely slow) and a stock-movement-type summary.
// listStockMovements/getStockDiscrepancies (inventory.service.ts) already cover movement history
// and ledger-vs-actual drift, reused as-is on the frontend rather than rebuilt here.
// ---------------------------------------------------------------------------

/** Stock-change volume by reason (order fulfillment, restock, manual adjustment, return) — the
 * aggregate view over what listStockMovements already shows row-by-row. */
export async function getStockMovementSummary(days?: number) {
  const cacheKey = `analytics:stock-movement-summary:${days ?? "all"}`;
  const cached = await cacheGet<Array<{ reason: string; movements: number; units: number }>>(cacheKey);
  if (cached) return cached;

  const since = await windowStart(days);
  const rows = await prisma.$queryRaw<Array<{ reason: string; movements: bigint; units: bigint }>>`
    SELECT reason::text AS reason, COUNT(*)::bigint AS movements, COALESCE(SUM(ABS(change)), 0)::bigint AS units
    FROM "StockMovement"
    WHERE "createdAt" >= ${utcInstant(since)}
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

/** Admin action volume, by admin and by action type — straight off the existing AuditLog table
 * (already written on every admin mutation), never previously aggregated for a report. */
export async function getAdminActivitySummary(days?: number, limit = 10) {
  const cacheKey = `analytics:admin-activity:${days ?? "all"}:${limit}`;
  const cached = await cacheGet<{ byAdmin: Array<{ id: string; name: string; actions: number }>; byAction: Array<{ action: string; count: number }> }>(
    cacheKey,
  );
  if (cached) return cached;

  const since = await windowStart(days);
  const [adminRows, actionRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string; actions: bigint }>>`
      SELECT a.id, a.name, COUNT(*)::bigint AS actions
      FROM "AuditLog" al
      JOIN "AdminUser" a ON a.id = al."adminId"
      WHERE al."createdAt" >= ${utcInstant(since)}
      GROUP BY a.id, a.name
      ORDER BY actions DESC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Array<{ action: string; count: bigint }>>`
      SELECT action, COUNT(*)::bigint AS count
      FROM "AuditLog"
      WHERE "createdAt" >= ${utcInstant(since)}
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

  const since = await windowStart(days);
  const rows = await prisma.$queryRaw<Array<{ totalWishlisted: bigint; converted: bigint }>>`
    WITH wishlisted AS (
      SELECT id, "customerId", "productId", "createdAt" FROM "WishlistItem" WHERE "createdAt" >= ${utcInstant(since)}
    ),
    converted AS (
      SELECT DISTINCT w.id
      FROM wishlisted w
      JOIN "Order" o ON o."customerId" = w."customerId" AND o."createdAt" >= w."createdAt" AND ${saleOrderSql("o")}
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

  const since = await windowStart(days);
  const [ratingRows, statusRows] = await Promise.all([
    prisma.$queryRaw<Array<{ rating: number; count: bigint }>>`
      SELECT rating, COUNT(*)::bigint AS count FROM "ProductReview" WHERE "createdAt" >= ${utcInstant(since)} GROUP BY rating ORDER BY rating ASC
    `,
    prisma.$queryRaw<Array<{ status: string; count: bigint; verified: bigint }>>`
      SELECT status::text AS status, COUNT(*)::bigint AS count, COUNT(*) FILTER (WHERE "isVerifiedPurchase")::bigint AS verified
      FROM "ProductReview"
      WHERE "createdAt" >= ${utcInstant(since)}
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

  const since = await windowStart(days);
  const rows = await prisma.$queryRaw<Array<{ total: bigint; read: bigint }>>`
    SELECT COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE "readAt" IS NOT NULL)::bigint AS read
    FROM "Feedback"
    WHERE "createdAt" >= ${utcInstant(since)}
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

