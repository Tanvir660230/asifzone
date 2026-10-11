import { Router } from "express";
import {
  trackPageViewSchema,
  trackPageExitSchema,
  trackFunnelEventSchema,
  attributeSearchSessionSchema,
  analyticsQuerySchema,
  bulkSendSmsSchema,
} from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { attachCustomerIfPresent } from "../../middlewares/require-customer";
import { validate } from "../../middlewares/validate";
import { trackingRateLimit } from "../../middlewares/rate-limit";
import * as analyticsController from "./analytics.controller";

export const analyticsRouter = Router();

// Public, anonymous beacons — registered before the requireAdmin gate below so the storefront can
// call them without a session. Same trust model as POST /api/products/:id/view.
// attachCustomerIfPresent (soft — never rejects) is what lets trackPageView know whether a valid
// customer session cookie rode along, without requiring one.
analyticsRouter.post(
  "/pageview",
  trackingRateLimit,
  attachCustomerIfPresent,
  validate(trackPageViewSchema),
  analyticsController.trackPageView,
);
analyticsRouter.post(
  "/pageview/:id/exit",
  trackingRateLimit,
  validate(trackPageExitSchema),
  analyticsController.trackPageExit,
);
analyticsRouter.post(
  "/funnel-event",
  trackingRateLimit,
  validate(trackFunnelEventSchema),
  analyticsController.trackFunnelEvent,
);
analyticsRouter.post(
  "/search-session",
  trackingRateLimit,
  validate(attributeSearchSessionSchema),
  analyticsController.attributeSearchSession,
);

analyticsRouter.use(requireAdmin, validate(analyticsQuerySchema, "query"));
analyticsRouter.get("/summary", requirePermission("analytics.read"), analyticsController.summary);
analyticsRouter.get("/revenue", requirePermission("analytics.read"), analyticsController.revenueSeries);
analyticsRouter.get("/order-status", requirePermission("analytics.read"), analyticsController.orderStatusCounts);
analyticsRouter.get("/top-products", requirePermission("analytics.read"), analyticsController.topProducts);
analyticsRouter.get("/low-stock", requirePermission("analytics.read"), analyticsController.lowStock);
analyticsRouter.get("/most-viewed-products", requirePermission("analytics.read"), analyticsController.mostViewedProducts);
analyticsRouter.get("/visitors", requirePermission("analytics.read"), analyticsController.visitorSeries);
analyticsRouter.get("/trending-products", requirePermission("analytics.read"), analyticsController.trendingProducts);
analyticsRouter.get("/search", requirePermission("analytics.read"), analyticsController.searchAnalytics);
analyticsRouter.get("/cart-abandonment", requirePermission("analytics.read"), analyticsController.cartAbandonment);
// The carts themselves (names, phones) — customer data, so gated like the CRM rather than like aggregate analytics.
analyticsRouter.get("/abandoned-carts", requirePermission("customers.read"), analyticsController.abandonedCarts);
analyticsRouter.post(
  "/abandoned-carts/remind",
  requirePermission("customers.message"),
  validate(bulkSendSmsSchema),
  analyticsController.remindAbandonedCarts,
);
analyticsRouter.get("/customer-insights", requirePermission("analytics.read"), analyticsController.customerInsights);
analyticsRouter.get("/cohort-retention", requirePermission("analytics.read"), analyticsController.cohortRetention);
analyticsRouter.get("/top-categories", requirePermission("analytics.read"), analyticsController.topCategories);
analyticsRouter.get("/top-brands", requirePermission("analytics.read"), analyticsController.topBrands);
analyticsRouter.get("/funnel", requirePermission("analytics.read"), analyticsController.conversionFunnel);
analyticsRouter.get("/traffic-sources", requirePermission("analytics.read"), analyticsController.trafficSources);
analyticsRouter.get("/campaigns", requirePermission("analytics.read"), analyticsController.campaignPerformance);
analyticsRouter.get("/active-visitors", requirePermission("analytics.read"), analyticsController.activeVisitors);
analyticsRouter.get("/traffic-heatmap", requirePermission("analytics.read"), analyticsController.trafficHeatmap);
analyticsRouter.get("/devices", requirePermission("analytics.read"), analyticsController.deviceBreakdown);
analyticsRouter.get("/browsers", requirePermission("analytics.read"), analyticsController.browserBreakdown);
analyticsRouter.get("/slow-moving-products", requirePermission("analytics.read"), analyticsController.slowMovingProducts);
analyticsRouter.get("/best-selling-prediction", requirePermission("analytics.read"), analyticsController.bestSellingPrediction);
analyticsRouter.get("/demand-forecast", requirePermission("analytics.read"), analyticsController.demandForecast);
analyticsRouter.get("/os", requirePermission("analytics.read"), analyticsController.osBreakdown);
analyticsRouter.get("/languages", requirePermission("analytics.read"), analyticsController.languageBreakdown);
analyticsRouter.get("/geo", requirePermission("analytics.read"), analyticsController.geoBreakdown);
analyticsRouter.get("/logged-in-vs-guest", requirePermission("analytics.read"), analyticsController.loggedInVsGuest);
analyticsRouter.get("/entry-exit-pages", requirePermission("analytics.read"), analyticsController.entryExitPages);
analyticsRouter.get("/engagement", requirePermission("analytics.read"), analyticsController.engagementSummary);
analyticsRouter.get("/returning-visitor-frequency", requirePermission("analytics.read"), analyticsController.returningVisitorFrequency);
analyticsRouter.get("/recent-sessions", requirePermission("analytics.read"), analyticsController.recentSessions);
analyticsRouter.get("/journey-funnel", requirePermission("analytics.read"), analyticsController.journeyFunnel);
analyticsRouter.get("/search-trends", requirePermission("analytics.read"), analyticsController.searchTrends);
analyticsRouter.get("/no-result-searches", requirePermission("analytics.read"), analyticsController.noResultSearches);
analyticsRouter.get("/search-conversion", requirePermission("analytics.read"), analyticsController.searchConversion);
analyticsRouter.get("/search-audience", requirePermission("analytics.read"), analyticsController.searchAudience);
analyticsRouter.get("/searches-by-city", requirePermission("analytics.read"), analyticsController.searchesByCity);
analyticsRouter.get("/most-added-to-cart", requirePermission("analytics.read"), analyticsController.mostAddedToCart);
analyticsRouter.get("/most-removed-from-cart", requirePermission("analytics.read"), analyticsController.mostRemovedFromCart);
analyticsRouter.get("/most-wishlisted", requirePermission("analytics.read"), analyticsController.mostWishlisted);
analyticsRouter.get("/product-conversion", requirePermission("analytics.read"), analyticsController.productConversionRates);
analyticsRouter.get("/highest-profit-products", requirePermission("analytics.read"), analyticsController.highestProfitProducts);
analyticsRouter.get("/product-risk", requirePermission("analytics.read"), analyticsController.productRiskMetrics);
analyticsRouter.get("/fbt-pairs", requirePermission("analytics.read"), analyticsController.frequentlyBoughtTogetherPairs);
analyticsRouter.get("/product-sales-heatmap", requirePermission("analytics.read"), analyticsController.productSalesHeatmap);
analyticsRouter.get("/variant-performance", requirePermission("analytics.read"), analyticsController.variantPerformance);
analyticsRouter.get("/size-color-performance", requirePermission("analytics.read"), analyticsController.sizeColorPerformance);
analyticsRouter.get("/inventory-turnover", requirePermission("analytics.read"), analyticsController.inventoryTurnover);
analyticsRouter.get("/customer-rfm", requirePermission("analytics.read"), analyticsController.customerRfmTable);
analyticsRouter.get("/purchase-frequency", requirePermission("analytics.read"), analyticsController.purchaseFrequencyDistribution);
analyticsRouter.get("/favorite-payment-method", requirePermission("analytics.read"), analyticsController.favoritePaymentMethod);
analyticsRouter.get("/purchase-time", requirePermission("analytics.read"), analyticsController.purchaseTimeDistribution);
analyticsRouter.get("/customer-location", requirePermission("analytics.read"), analyticsController.customerLocationBreakdown);

// Section 7 — Marketing Intelligence
analyticsRouter.get("/coupon-effectiveness", requirePermission("analytics.read"), analyticsController.couponEffectiveness);
analyticsRouter.get("/bundle-performance", requirePermission("analytics.read"), analyticsController.bundlePerformance);
analyticsRouter.get("/flash-sale-performance", requirePermission("analytics.read"), analyticsController.flashSalePerformance);
analyticsRouter.get("/campaign-delivery", requirePermission("analytics.read"), analyticsController.campaignDeliveryStats);
analyticsRouter.get("/loyalty-points", requirePermission("analytics.read"), analyticsController.loyaltyPointsOverview);

// Section 8 — Sales Intelligence
analyticsRouter.get("/discount-usage", requirePermission("analytics.read"), analyticsController.discountUsageBreakdown);
analyticsRouter.get("/return-request-analytics", requirePermission("analytics.read"), analyticsController.returnRequestAnalytics);
analyticsRouter.get("/courier-performance", requirePermission("analytics.read"), analyticsController.courierPerformance);

// Section 9 — Financial Analytics
analyticsRouter.get("/profit-trend", requirePermission("analytics.read"), analyticsController.profitTrend);
analyticsRouter.get("/financial-costs", requirePermission("analytics.read"), analyticsController.financialCostBreakdown);
analyticsRouter.get("/estimated-tax", requirePermission("analytics.read"), analyticsController.estimatedTax);

// Section 10 — Inventory Intelligence
analyticsRouter.get("/dead-stock", requirePermission("analytics.read"), analyticsController.deadStock);
analyticsRouter.get("/stock-movement-summary", requirePermission("analytics.read"), analyticsController.stockMovementSummary);

// Section 11 — Operational Analytics
analyticsRouter.get("/fulfillment-time", requirePermission("analytics.read"), analyticsController.fulfillmentTime);
analyticsRouter.get("/admin-activity", requirePermission("analytics.read"), analyticsController.adminActivitySummary);

// Section 12 — User Behavior
analyticsRouter.get("/wishlist-conversion", requirePermission("analytics.read"), analyticsController.wishlistConversion);
analyticsRouter.get("/review-behavior", requirePermission("analytics.read"), analyticsController.reviewBehavior);
analyticsRouter.get("/feedback-volume", requirePermission("analytics.read"), analyticsController.feedbackVolume);

// Section 14 — Lifetime Data
analyticsRouter.get("/lifetime-yearly-trend", requirePermission("analytics.read"), analyticsController.lifetimeYearlyTrend);

// Section 15 — Reports (CSV)
analyticsRouter.get("/export/customer-rfm.csv", requirePermission("analytics.export"), analyticsController.exportCustomerRfmCsv);
analyticsRouter.get("/export/revenue.csv", requirePermission("analytics.export"), analyticsController.exportRevenueSeriesCsv);
analyticsRouter.get("/export/inventory-turnover.csv", requirePermission("analytics.export"), analyticsController.exportInventoryTurnoverCsv);
