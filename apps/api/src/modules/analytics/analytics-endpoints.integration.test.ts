import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";

// Phase 5 re-implemented every sales/product/customer/financial report on the metrics engine and moved every raw-SQL
// time window onto the business-time mechanism (docs/METRICS_REGISTRY.md). No analytics endpoint had a test before
// (PHASE_5_METRICS_AUDIT). This calls every one — windowed, lifetime and custom-range — against the real database, with
// at least one realised order present, and requires a 200 with a body.

const ANALYTICS = [
  "summary", "revenue", "order-status", "top-products", "low-stock", "most-viewed-products", "visitors", "trending-products", "search",
  "cart-abandonment", "customer-insights", "cohort-retention", "top-categories", "top-brands", "funnel", "traffic-sources", "campaigns",
  "active-visitors", "traffic-heatmap", "devices", "browsers", "slow-moving-products", "best-selling-prediction", "demand-forecast", "os",
  "languages", "geo", "logged-in-vs-guest", "entry-exit-pages", "engagement", "returning-visitor-frequency", "recent-sessions",
  "journey-funnel", "search-trends", "no-result-searches", "search-conversion", "search-audience", "searches-by-city", "most-added-to-cart",
  "most-removed-from-cart", "most-wishlisted", "product-conversion", "highest-profit-products", "product-risk", "fbt-pairs",
  "product-sales-heatmap", "variant-performance", "size-color-performance", "inventory-turnover", "customer-rfm", "purchase-frequency",
  "favorite-payment-method", "purchase-time", "customer-location", "coupon-effectiveness", "bundle-performance", "flash-sale-performance",
  "campaign-delivery", "loyalty-points", "discount-usage", "return-request-analytics", "courier-performance", "profit-trend",
  "financial-costs", "estimated-tax", "dead-stock", "stock-movement-summary", "fulfillment-time", "admin-activity", "wishlist-conversion",
  "review-behavior", "feedback-volume", "lifetime-yearly-trend", "export/customer-rfm.csv", "export/revenue.csv", "export/inventory-turnover.csv",
];

beforeAll(async () => {
  const admin = await ownerId();
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  const o = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await updateOrderStatus(o.id, { status: "DELIVERED" }, admin);
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("every analytics and BI endpoint answers on the metrics SSOT", () => {
  it.each(ANALYTICS)("GET /api/analytics/%s (default, 7 days, custom range)", async (path) => {
    const api = await asOwner();
    const from = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const to = new Date().toISOString();
    for (const query of ["", "?days=7", `?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`]) {
      const res = await api.get(`/api/analytics/${path}${query}`);
      expect(res.status, `${path}${query}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
    }
  });

  it("BI overview and automated insights carry the registry figures", async () => {
    const api = await asOwner();
    const overview = await api.get("/api/bi/overview");
    expect(overview.status).toBe(200);
    for (const key of ["revenueToday", "revenueThisMonth", "collectedCashThisMonth", "refundsThisMonth", "returnsThisMonth", "outstandingCod", "refundDue", "taxThisMonth"]) {
      expect(typeof overview.body[key], key).toBe("number");
    }
    const insights = await api.get("/api/bi/automated-insights");
    expect(insights.status).toBe(200);
  });

  it("the dashboard's net sales equals the metrics API for the same 30-business-day range (one number per metric)", async () => {
    const api = await asOwner();
    const [dashboard, metrics] = await Promise.all([api.get("/api/analytics/summary"), api.get("/api/v1/metrics?metrics=net_sales,orders_realised&preset=last_30_days")]);
    expect(dashboard.body.revenue30d).toBeCloseTo(metrics.body.metrics.net_sales.value, 2);
    expect(dashboard.body.orders30d).toBe(metrics.body.metrics.orders_realised.value);
  });
});
