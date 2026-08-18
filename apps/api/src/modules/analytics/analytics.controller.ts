import type { Request, Response } from "express";
import type {
  TrackPageViewInput,
  TrackPageExitInput,
  TrackFunnelEventInput,
  AttributeSearchSessionInput,
  AnalyticsQuery,
} from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import * as analyticsService from "./analytics.service";

// req.query has already been through analyticsQuerySchema (see analytics.routes.ts) by the time
// any handler below runs — coerced to numbers and bounded (days: 1-365, limit: 1-100) — so this
// is just picking the per-endpoint default for whichever field the caller left out.
function query(req: Request): AnalyticsQuery {
  return req.query as unknown as AnalyticsQuery;
}

export const summary = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await analyticsService.getDashboardSummary());
});

export const revenueSeries = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30 } = query(req);
  res.json({ series: await analyticsService.getRevenueSeries(days) });
});

export const orderStatusCounts = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ counts: await analyticsService.getOrderStatusCounts() });
});

export const topProducts = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 5 } = query(req);
  res.json({ products: await analyticsService.getTopProducts(days, limit) });
});

export const lowStock = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ variants: await analyticsService.getLowStockVariants() });
});

export const trackPageView = asyncHandler(async (req: Request, res: Response) => {
  const id = await analyticsService.trackPageView(
    req.body as TrackPageViewInput,
    req.get("user-agent") ?? null,
    req.ip ?? null,
    req.get("accept-language") ?? null,
    Boolean(req.customer),
  );
  res.status(201).json({ id });
});

export const trackPageExit = asyncHandler(async (req: Request, res: Response) => {
  await analyticsService.trackPageExit(req.params.id!, req.body as TrackPageExitInput);
  res.status(204).end();
});

export const trackFunnelEvent = asyncHandler(async (req: Request, res: Response) => {
  await analyticsService.trackFunnelEvent(req.body as TrackFunnelEventInput);
  res.status(204).end();
});

export const attributeSearchSession = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as AttributeSearchSessionInput;
  await analyticsService.attributeSearchSession(body.sessionId, body.visitorId ?? null, body.query);
  res.status(204).end();
});

export const mostViewedProducts = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json({ products: await analyticsService.getMostViewedProducts(days, limit) });
});

export const visitorSeries = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30 } = query(req);
  res.json({ series: await analyticsService.getVisitorSeries(days) });
});

export const trendingProducts = asyncHandler(async (req: Request, res: Response) => {
  const { limit = 10 } = query(req);
  res.json({ products: await analyticsService.getTrendingProducts(limit) });
});

export const searchAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json(await analyticsService.getSearchAnalytics(days, limit));
});

export const cartAbandonment = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await analyticsService.getCartAbandonmentSummary());
});

export const customerInsights = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await analyticsService.getCustomerInsights());
});

export const cohortRetention = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ cohorts: await analyticsService.getCohortRetention() });
});

export const topCategories = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json({ categories: await analyticsService.getTopCategories(days, limit) });
});

export const topBrands = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json({ brands: await analyticsService.getTopBrands(days, limit) });
});

export const conversionFunnel = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30 } = query(req);
  res.json(await analyticsService.getConversionFunnel(days));
});

export const trafficSources = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json({ sources: await analyticsService.getTrafficSources(days, limit) });
});

export const campaignPerformance = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json({ campaigns: await analyticsService.getCampaignPerformance(days, limit) });
});

export const activeVisitors = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ count: await analyticsService.getActiveVisitorCount() });
});

export const trafficHeatmap = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30 } = query(req);
  res.json({ cells: await analyticsService.getTrafficHeatmap(days) });
});

export const deviceBreakdown = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30 } = query(req);
  res.json({ devices: await analyticsService.getDeviceBreakdown(days) });
});

export const browserBreakdown = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30 } = query(req);
  res.json({ browsers: await analyticsService.getBrowserBreakdown(days) });
});

export const slowMovingProducts = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30, limit = 10 } = query(req);
  res.json({ products: await analyticsService.getSlowMovingProducts(days, limit) });
});

export const bestSellingPrediction = asyncHandler(async (req: Request, res: Response) => {
  const { limit = 10 } = query(req);
  res.json({ products: await analyticsService.getBestSellingPrediction(limit) });
});

export const demandForecast = asyncHandler(async (req: Request, res: Response) => {
  const { days = 14, limit = 10 } = query(req);
  res.json({ variants: await analyticsService.getDemandForecast(days, limit) });
});

// From here down: `days` is left undefined (not defaulted to 30) when the caller omits it —
// analyticsService treats that as "lifetime", the "All" option in the visitor-analytics range
// selector.

export const osBreakdown = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json({ os: await analyticsService.getOsBreakdown(days) });
});

export const languageBreakdown = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json({ languages: await analyticsService.getLanguageBreakdown(days, limit) });
});

export const geoBreakdown = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json(await analyticsService.getGeoBreakdown(days, limit));
});

export const loggedInVsGuest = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getLoggedInVsGuest(days));
});

export const entryExitPages = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json(await analyticsService.getEntryExitPages(days, limit));
});

export const engagementSummary = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getEngagementSummary(days));
});

export const returningVisitorFrequency = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ buckets: await analyticsService.getReturningVisitorFrequency() });
});

export const recentSessions = asyncHandler(async (req: Request, res: Response) => {
  const { limit = 20 } = query(req);
  res.json({ sessions: await analyticsService.getRecentSessions(limit) });
});

export const journeyFunnel = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getVisitorJourneyFunnel(days));
});

export const searchTrends = asyncHandler(async (req: Request, res: Response) => {
  const { limit = 10 } = query(req);
  res.json({ queries: await analyticsService.getSearchTrends(limit) });
});

export const noResultSearches = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 20 } = query(req);
  res.json({ queries: await analyticsService.getNoResultSearches(days, limit) });
});

export const searchConversion = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getSearchConversion(days));
});

export const searchAudience = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getSearchAudience(days));
});

export const searchesByCity = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json({ cities: await analyticsService.getSearchesByCity(days, limit) });
});

export const mostAddedToCart = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json({ products: await analyticsService.getMostAddedToCart(days, limit) });
});

export const mostRemovedFromCart = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json({ products: await analyticsService.getMostRemovedFromCart(days, limit) });
});

export const mostWishlisted = asyncHandler(async (req: Request, res: Response) => {
  const { limit = 10 } = query(req);
  res.json({ products: await analyticsService.getMostWishlisted(limit) });
});

export const productConversionRates = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json({ products: await analyticsService.getProductConversionRates(days) });
});

export const highestProfitProducts = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json({ products: await analyticsService.getHighestProfitProducts(days, limit) });
});

export const productRiskMetrics = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json({ products: await analyticsService.getProductRiskMetrics(days, limit) });
});

export const frequentlyBoughtTogetherPairs = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json({ pairs: await analyticsService.getFrequentlyBoughtTogetherPairs(days, limit) });
});

export const productSalesHeatmap = asyncHandler(async (req: Request, res: Response) => {
  const { days = 14, limit = 10 } = query(req);
  res.json(await analyticsService.getProductSalesHeatmap(days, limit));
});

export const variantPerformance = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json({ variants: await analyticsService.getVariantPerformance(days, limit) });
});

export const sizeColorPerformance = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getSizeColorPerformance(days));
});

export const inventoryTurnover = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json({ products: await analyticsService.getInventoryTurnover(days, limit) });
});

export const customerRfmTable = asyncHandler(async (req: Request, res: Response) => {
  const { limit = 50 } = query(req);
  res.json({ customers: await analyticsService.getCustomerRfmTable(limit) });
});

export const purchaseFrequencyDistribution = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ buckets: await analyticsService.getPurchaseFrequencyDistribution() });
});

export const favoritePaymentMethod = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json({ methods: await analyticsService.getFavoritePaymentMethod(days) });
});

export const purchaseTimeDistribution = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getPurchaseTimeDistribution(days));
});

export const customerLocationBreakdown = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json(await analyticsService.getCustomerLocationBreakdown(days, limit));
});

// Section 7 — Marketing Intelligence

export const couponEffectiveness = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json({ coupons: await analyticsService.getCouponEffectiveness(days, limit) });
});

export const bundlePerformance = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json({ bundles: await analyticsService.getBundlePerformance(days, limit) });
});

export const flashSalePerformance = asyncHandler(async (req: Request, res: Response) => {
  const { limit = 10 } = query(req);
  res.json({ sales: await analyticsService.getFlashSalePerformance(limit) });
});

export const campaignDeliveryStats = asyncHandler(async (req: Request, res: Response) => {
  const { limit = 10 } = query(req);
  res.json({ campaigns: await analyticsService.getCampaignDeliveryStats(limit) });
});

export const loyaltyPointsOverview = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await analyticsService.getLoyaltyPointsOverview());
});

// Section 8 — Sales Intelligence

export const discountUsageBreakdown = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getDiscountUsageBreakdown(days));
});

export const returnRequestAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getReturnRequestAnalytics(days));
});

export const courierPerformance = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getCourierPerformance(days));
});

// Section 9 — Financial Analytics

export const profitTrend = asyncHandler(async (req: Request, res: Response) => {
  const { days = 30 } = query(req);
  res.json({ series: await analyticsService.getProfitTrend(days) });
});

export const financialCostBreakdown = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getFinancialCostBreakdown(days));
});

export const estimatedTax = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getEstimatedTaxCollected(days));
});

// Section 10 — Inventory Intelligence

export const deadStock = asyncHandler(async (req: Request, res: Response) => {
  const { days = 90, limit = 10 } = query(req);
  res.json({ variants: await analyticsService.getDeadStockReport(days, limit) });
});

export const stockMovementSummary = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json({ reasons: await analyticsService.getStockMovementSummary(days) });
});

// Section 11 — Operational Analytics

export const fulfillmentTime = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getOrderFulfillmentTime(days));
});

export const adminActivitySummary = asyncHandler(async (req: Request, res: Response) => {
  const { days, limit = 10 } = query(req);
  res.json(await analyticsService.getAdminActivitySummary(days, limit));
});

// Section 12 — User Behavior

export const wishlistConversion = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getWishlistConversionRate(days));
});

export const reviewBehavior = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getReviewBehaviorStats(days));
});

export const feedbackVolume = asyncHandler(async (req: Request, res: Response) => {
  const { days } = query(req);
  res.json(await analyticsService.getFeedbackVolume(days));
});

// Section 14 — Lifetime Data

export const lifetimeYearlyTrend = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ years: await analyticsService.getLifetimeYearlyTrend() });
});

// Section 15 — Reports (CSV exports). Same header-escaping shape as order.service.ts's
// exportOrdersCsv, kept local since it's small and this is the only other CSV producer in the app.
function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(header: string[], rows: Array<Array<string | number>>): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function sendCsv(res: Response, filenamePrefix: string, csv: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filenamePrefix}-${Date.now()}.csv"`);
  res.send(csv);
}

export const exportCustomerRfmCsv = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await analyticsService.getCustomerRfmTable(1000);
  const csv = toCsv(
    ["Customer", "Recency (days)", "Frequency", "Monetary", "Tags"],
    rows.map((r) => [r.name, r.recencyDays ?? "", r.frequency, r.monetary, r.tags.join("; ")]),
  );
  sendCsv(res, "customer-rfm", csv);
});

export const exportRevenueSeriesCsv = asyncHandler(async (req: Request, res: Response) => {
  const { days = 365 } = query(req);
  const series = await analyticsService.getRevenueSeries(days);
  const csv = toCsv(
    ["Date", "Revenue", "Orders"],
    series.map((p) => [p.date, p.revenue, p.orders]),
  );
  sendCsv(res, "revenue", csv);
});

export const exportInventoryTurnoverCsv = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await analyticsService.getInventoryTurnover(undefined, 1000);
  const csv = toCsv(
    ["Product", "Slug", "COGS Sold", "Inventory Value", "Turnover Ratio"],
    rows.map((r) => [r.name, r.slug, r.cogsSold, r.inventoryValue, r.turnoverRatio.toFixed(2)]),
  );
  sendCsv(res, "inventory-turnover", csv);
});
