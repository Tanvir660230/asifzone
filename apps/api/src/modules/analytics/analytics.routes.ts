import { Router } from "express";
import {
  trackPageViewSchema,
  trackPageExitSchema,
  trackFunnelEventSchema,
  attributeSearchSessionSchema,
  analyticsQuerySchema,
} from "@clothing-brand/shared";
import { requireAdmin } from "../../middlewares/require-admin";
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
analyticsRouter.get("/summary", analyticsController.summary);
analyticsRouter.get("/revenue", analyticsController.revenueSeries);
analyticsRouter.get("/order-status", analyticsController.orderStatusCounts);
analyticsRouter.get("/top-products", analyticsController.topProducts);
analyticsRouter.get("/low-stock", analyticsController.lowStock);
analyticsRouter.get("/most-viewed-products", analyticsController.mostViewedProducts);
analyticsRouter.get("/visitors", analyticsController.visitorSeries);
analyticsRouter.get("/trending-products", analyticsController.trendingProducts);
analyticsRouter.get("/search", analyticsController.searchAnalytics);
analyticsRouter.get("/cart-abandonment", analyticsController.cartAbandonment);
analyticsRouter.get("/customer-insights", analyticsController.customerInsights);
analyticsRouter.get("/cohort-retention", analyticsController.cohortRetention);
analyticsRouter.get("/top-categories", analyticsController.topCategories);
analyticsRouter.get("/top-brands", analyticsController.topBrands);
analyticsRouter.get("/funnel", analyticsController.conversionFunnel);
analyticsRouter.get("/traffic-sources", analyticsController.trafficSources);
analyticsRouter.get("/campaigns", analyticsController.campaignPerformance);
analyticsRouter.get("/active-visitors", analyticsController.activeVisitors);
analyticsRouter.get("/traffic-heatmap", analyticsController.trafficHeatmap);
analyticsRouter.get("/devices", analyticsController.deviceBreakdown);
analyticsRouter.get("/browsers", analyticsController.browserBreakdown);
analyticsRouter.get("/slow-moving-products", analyticsController.slowMovingProducts);
analyticsRouter.get("/best-selling-prediction", analyticsController.bestSellingPrediction);
analyticsRouter.get("/demand-forecast", analyticsController.demandForecast);
analyticsRouter.get("/os", analyticsController.osBreakdown);
analyticsRouter.get("/languages", analyticsController.languageBreakdown);
analyticsRouter.get("/geo", analyticsController.geoBreakdown);
analyticsRouter.get("/logged-in-vs-guest", analyticsController.loggedInVsGuest);
analyticsRouter.get("/entry-exit-pages", analyticsController.entryExitPages);
analyticsRouter.get("/engagement", analyticsController.engagementSummary);
analyticsRouter.get("/returning-visitor-frequency", analyticsController.returningVisitorFrequency);
analyticsRouter.get("/recent-sessions", analyticsController.recentSessions);
analyticsRouter.get("/journey-funnel", analyticsController.journeyFunnel);
analyticsRouter.get("/search-trends", analyticsController.searchTrends);
analyticsRouter.get("/no-result-searches", analyticsController.noResultSearches);
analyticsRouter.get("/search-conversion", analyticsController.searchConversion);
analyticsRouter.get("/search-audience", analyticsController.searchAudience);
analyticsRouter.get("/searches-by-city", analyticsController.searchesByCity);
analyticsRouter.get("/most-added-to-cart", analyticsController.mostAddedToCart);
analyticsRouter.get("/most-removed-from-cart", analyticsController.mostRemovedFromCart);
analyticsRouter.get("/most-wishlisted", analyticsController.mostWishlisted);
analyticsRouter.get("/product-conversion", analyticsController.productConversionRates);
analyticsRouter.get("/highest-profit-products", analyticsController.highestProfitProducts);
analyticsRouter.get("/product-risk", analyticsController.productRiskMetrics);
analyticsRouter.get("/fbt-pairs", analyticsController.frequentlyBoughtTogetherPairs);
analyticsRouter.get("/product-sales-heatmap", analyticsController.productSalesHeatmap);
analyticsRouter.get("/variant-performance", analyticsController.variantPerformance);
analyticsRouter.get("/size-color-performance", analyticsController.sizeColorPerformance);
analyticsRouter.get("/inventory-turnover", analyticsController.inventoryTurnover);
analyticsRouter.get("/customer-rfm", analyticsController.customerRfmTable);
analyticsRouter.get("/purchase-frequency", analyticsController.purchaseFrequencyDistribution);
analyticsRouter.get("/favorite-payment-method", analyticsController.favoritePaymentMethod);
analyticsRouter.get("/purchase-time", analyticsController.purchaseTimeDistribution);
analyticsRouter.get("/customer-location", analyticsController.customerLocationBreakdown);

// Section 7 — Marketing Intelligence
analyticsRouter.get("/coupon-effectiveness", analyticsController.couponEffectiveness);
analyticsRouter.get("/bundle-performance", analyticsController.bundlePerformance);
analyticsRouter.get("/flash-sale-performance", analyticsController.flashSalePerformance);
analyticsRouter.get("/campaign-delivery", analyticsController.campaignDeliveryStats);
analyticsRouter.get("/loyalty-points", analyticsController.loyaltyPointsOverview);

// Section 8 — Sales Intelligence
analyticsRouter.get("/discount-usage", analyticsController.discountUsageBreakdown);
analyticsRouter.get("/return-request-analytics", analyticsController.returnRequestAnalytics);
analyticsRouter.get("/courier-performance", analyticsController.courierPerformance);

// Section 9 — Financial Analytics
analyticsRouter.get("/profit-trend", analyticsController.profitTrend);
analyticsRouter.get("/financial-costs", analyticsController.financialCostBreakdown);
analyticsRouter.get("/estimated-tax", analyticsController.estimatedTax);

// Section 10 — Inventory Intelligence
analyticsRouter.get("/dead-stock", analyticsController.deadStock);
analyticsRouter.get("/stock-movement-summary", analyticsController.stockMovementSummary);

// Section 11 — Operational Analytics
analyticsRouter.get("/fulfillment-time", analyticsController.fulfillmentTime);
analyticsRouter.get("/admin-activity", analyticsController.adminActivitySummary);

// Section 12 — User Behavior
analyticsRouter.get("/wishlist-conversion", analyticsController.wishlistConversion);
analyticsRouter.get("/review-behavior", analyticsController.reviewBehavior);
analyticsRouter.get("/feedback-volume", analyticsController.feedbackVolume);

// Section 14 — Lifetime Data
analyticsRouter.get("/lifetime-yearly-trend", analyticsController.lifetimeYearlyTrend);

// Section 15 — Reports (CSV)
analyticsRouter.get("/export/customer-rfm.csv", analyticsController.exportCustomerRfmCsv);
analyticsRouter.get("/export/revenue.csv", analyticsController.exportRevenueSeriesCsv);
analyticsRouter.get("/export/inventory-turnover.csv", analyticsController.exportInventoryTurnoverCsv);
