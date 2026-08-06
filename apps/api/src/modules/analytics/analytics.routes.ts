import { Router } from "express";
import { trackPageViewSchema } from "@clothing-brand/shared";
import { requireAdmin } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { trackingRateLimit } from "../../middlewares/rate-limit";
import * as analyticsController from "./analytics.controller";

export const analyticsRouter = Router();

// Public, anonymous beacon — registered before the requireAdmin gate below so the storefront can
// call it without a session. Same trust model as POST /api/products/:id/view.
analyticsRouter.post(
  "/pageview",
  trackingRateLimit,
  validate(trackPageViewSchema),
  analyticsController.trackPageView,
);

analyticsRouter.use(requireAdmin);
analyticsRouter.get("/summary", analyticsController.summary);
analyticsRouter.get("/revenue", analyticsController.revenueSeries);
analyticsRouter.get("/order-status", analyticsController.orderStatusCounts);
analyticsRouter.get("/top-products", analyticsController.topProducts);
analyticsRouter.get("/low-stock", analyticsController.lowStock);
analyticsRouter.get("/most-viewed-products", analyticsController.mostViewedProducts);
analyticsRouter.get("/search", analyticsController.searchAnalytics);
analyticsRouter.get("/cart-abandonment", analyticsController.cartAbandonment);
analyticsRouter.get("/customer-insights", analyticsController.customerInsights);
analyticsRouter.get("/top-categories", analyticsController.topCategories);
analyticsRouter.get("/top-brands", analyticsController.topBrands);
analyticsRouter.get("/funnel", analyticsController.conversionFunnel);
analyticsRouter.get("/traffic-sources", analyticsController.trafficSources);
analyticsRouter.get("/campaigns", analyticsController.campaignPerformance);
analyticsRouter.get("/slow-moving-products", analyticsController.slowMovingProducts);
analyticsRouter.get("/best-selling-prediction", analyticsController.bestSellingPrediction);
analyticsRouter.get("/demand-forecast", analyticsController.demandForecast);
