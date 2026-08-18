import { apiFetch } from "../api-client";
import { env } from "../env";

export interface DashboardSummary {
  revenue30d: number;
  orders30d: number;
  revenuePrev30d: number;
  ordersPrev30d: number;
  pendingOrders: number;
  lowStockCount: number;
  aov30d: number;
  aovPrev30d: number;
  uniqueVisitors30d: number;
  uniqueVisitorsPrev30d: number;
  courierLoss30d: number;
  courierLossCount30d: number;
}

export interface RevenuePoint {
  date: string;
  revenue: number;
  orders: number;
}

export interface OrderStatusCount {
  status: string;
  count: number;
}

export interface TopProduct {
  name: string;
  quantitySold: number;
  revenue: number;
  productId: string | null;
  imageUrl: string | null;
}

export interface LowStockVariant {
  id: string;
  sku: string;
  size: string;
  color: string;
  colorHex: string | null;
  stock: number;
  image: { url: string } | null;
  product: { id: string; name: string; slug: string; images: { url: string }[] };
}

export function getSummary() {
  return apiFetch<DashboardSummary>("/api/analytics/summary");
}

export function getRevenueSeries(days = 30) {
  return apiFetch<{ series: RevenuePoint[] }>(`/api/analytics/revenue?days=${days}`);
}

export function getOrderStatusCounts() {
  return apiFetch<{ counts: OrderStatusCount[] }>("/api/analytics/order-status");
}

export function getTopProducts(days = 30, limit = 5) {
  return apiFetch<{ products: TopProduct[] }>(`/api/analytics/top-products?days=${days}&limit=${limit}`);
}

export function getLowStock() {
  return apiFetch<{ variants: LowStockVariant[] }>("/api/analytics/low-stock");
}

export interface MostViewedProduct {
  id: string;
  name: string;
  slug: string;
  views: number;
}

export function getMostViewedProducts(days = 30, limit = 10) {
  return apiFetch<{ products: MostViewedProduct[] }>(`/api/analytics/most-viewed-products?days=${days}&limit=${limit}`);
}

export interface VisitorPoint {
  date: string;
  visitors: number;
  pageViews: number;
}

export function getVisitorSeries(days = 30) {
  return apiFetch<{ series: VisitorPoint[] }>(`/api/analytics/visitors?days=${days}`);
}

export interface TrendingProduct {
  id: string;
  name: string;
  slug: string;
  recentViews: number;
  priorViews: number;
  growthPct: number;
}

export function getTrendingProducts(limit = 10) {
  return apiFetch<{ products: TrendingProduct[] }>(`/api/analytics/trending-products?limit=${limit}`);
}

export interface SearchAnalytics {
  topQueries: Array<{ query: string; count: number }>;
  totalSearches: number;
  zeroResultSearches: number;
  zeroResultRate: number;
}

export function getSearchAnalytics(days = 30, limit = 10) {
  return apiFetch<SearchAnalytics>(`/api/analytics/search?days=${days}&limit=${limit}`);
}

export interface CartAbandonmentSummary {
  cartCount: number;
  potentialRevenue: number;
}

export function getCartAbandonment() {
  return apiFetch<CartAbandonmentSummary>("/api/analytics/cart-abandonment");
}

export interface CustomerInsights {
  totalCustomers: number;
  returningCustomers: number;
  returningRate: number;
  avgClv: number;
}

export function getCustomerInsights() {
  return apiFetch<CustomerInsights>("/api/analytics/customer-insights");
}

export interface CohortRetentionPoint {
  monthOffset: number;
  activeCustomers: number;
  retentionPct: number;
}

export interface CohortRetention {
  cohortMonth: string;
  cohortSize: number;
  retention: CohortRetentionPoint[];
}

export function getCohortRetention() {
  return apiFetch<{ cohorts: CohortRetention[] }>("/api/analytics/cohort-retention");
}

export interface CategoryOrBrandStat {
  name: string;
  quantitySold: number;
  revenue: number;
}

export function getTopCategories(days = 30, limit = 10) {
  return apiFetch<{ categories: CategoryOrBrandStat[] }>(`/api/analytics/top-categories?days=${days}&limit=${limit}`);
}

export function getTopBrands(days = 30, limit = 10) {
  return apiFetch<{ brands: CategoryOrBrandStat[] }>(`/api/analytics/top-brands?days=${days}&limit=${limit}`);
}

export interface ConversionFunnel {
  totalSessions: number;
  bouncedSessions: number;
  convertedSessions: number;
  conversionRate: number;
  bounceRate: number;
}

export function getConversionFunnel(days = 30) {
  return apiFetch<ConversionFunnel>(`/api/analytics/funnel?days=${days}`);
}

export interface TrafficSource {
  source: string;
  sessions: number;
}

export function getTrafficSources(days = 30, limit = 10) {
  return apiFetch<{ sources: TrafficSource[] }>(`/api/analytics/traffic-sources?days=${days}&limit=${limit}`);
}

export interface CampaignStat {
  campaign: string;
  orders: number;
  revenue: number;
}

export function getCampaignPerformance(days = 30, limit = 10) {
  return apiFetch<{ campaigns: CampaignStat[] }>(`/api/analytics/campaigns?days=${days}&limit=${limit}`);
}

export function getActiveVisitors() {
  return apiFetch<{ count: number }>("/api/analytics/active-visitors");
}

export interface HeatmapCell {
  dow: number;
  hour: number;
  count: number;
}

export function getTrafficHeatmap(days = 30) {
  return apiFetch<{ cells: HeatmapCell[] }>(`/api/analytics/traffic-heatmap?days=${days}`);
}

export interface DeviceStat {
  device: string;
  sessions: number;
}

export function getDeviceBreakdown(days = 30) {
  return apiFetch<{ devices: DeviceStat[] }>(`/api/analytics/devices?days=${days}`);
}

export interface BrowserStat {
  browser: string;
  sessions: number;
}

export function getBrowserBreakdown(days = 30) {
  return apiFetch<{ browsers: BrowserStat[] }>(`/api/analytics/browsers?days=${days}`);
}

export interface SlowMovingProduct {
  id: string;
  name: string;
  slug: string;
  unitsSold: number;
  totalStock: number;
}

export function getSlowMovingProducts(days = 30, limit = 10) {
  return apiFetch<{ products: SlowMovingProduct[] }>(`/api/analytics/slow-moving-products?days=${days}&limit=${limit}`);
}

export interface BestSellingPrediction {
  name: string;
  recentUnits: number;
  priorUnits: number;
  growthPct: number;
}

export function getBestSellingPrediction(limit = 10) {
  return apiFetch<{ products: BestSellingPrediction[] }>(`/api/analytics/best-selling-prediction?limit=${limit}`);
}

export interface DemandForecastVariant {
  variantId: string;
  productName: string;
  sku: string;
  stock: number;
  dailyVelocity: number;
  projected7d: number;
  daysUntilStockout: number;
}

export function getDemandForecast(days = 14, limit = 10) {
  return apiFetch<{ variants: DemandForecastVariant[] }>(`/api/analytics/demand-forecast?days=${days}&limit=${limit}`);
}

/** Builds a query string from {days, limit} where `days === undefined` means "all time" — omitted
 * from the string entirely rather than sent as a value, since analyticsQuerySchema on the API side
 * treats an absent `days` the same way (see analytics.service.ts's daysAgoOrUndefined). */
function windowParams(params: Record<string, number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export interface OsStat {
  os: string;
  sessions: number;
}

export function getOsBreakdown(days?: number) {
  return apiFetch<{ os: OsStat[] }>(`/api/analytics/os${windowParams({ days })}`);
}

export interface LanguageStat {
  language: string;
  sessions: number;
}

export function getLanguageBreakdown(days?: number, limit = 10) {
  return apiFetch<{ languages: LanguageStat[] }>(`/api/analytics/languages${windowParams({ days, limit })}`);
}

export interface GeoBreakdown {
  countries: Array<{ countryCode: string; sessions: number }>;
  regions: Array<{ region: string; sessions: number }>;
  cities: Array<{ city: string; sessions: number }>;
}

export function getGeoBreakdown(days?: number, limit = 10) {
  return apiFetch<GeoBreakdown>(`/api/analytics/geo${windowParams({ days, limit })}`);
}

export interface LoggedInVsGuest {
  loggedIn: number;
  guest: number;
}

export function getLoggedInVsGuest(days?: number) {
  return apiFetch<LoggedInVsGuest>(`/api/analytics/logged-in-vs-guest${windowParams({ days })}`);
}

export interface EntryExitPages {
  entryPages: Array<{ path: string; sessions: number }>;
  exitPages: Array<{ path: string; sessions: number }>;
}

export function getEntryExitPages(days?: number, limit = 10) {
  return apiFetch<EntryExitPages>(`/api/analytics/entry-exit-pages${windowParams({ days, limit })}`);
}

export interface EngagementSummary {
  avgTimePerPageMs: number;
  avgScrollDepthPct: number;
  avgClicksPerPage: number;
  avgSessionDurationMs: number;
  avgPagesPerSession: number;
}

export function getEngagementSummary(days?: number) {
  return apiFetch<EngagementSummary>(`/api/analytics/engagement${windowParams({ days })}`);
}

export interface ReturningVisitorBucket {
  bucket: string;
  visitors: number;
}

export function getReturningVisitorFrequency() {
  return apiFetch<{ buckets: ReturningVisitorBucket[] }>("/api/analytics/returning-visitor-frequency");
}

export interface RecentSession {
  sessionId: string;
  visitorId: string | null;
  entryPath: string;
  exitPath: string;
  pageCount: number;
  totalDurationMs: number;
  device: string;
  startedAt: string;
}

export function getRecentSessions(limit = 20) {
  return apiFetch<{ sessions: RecentSession[] }>(`/api/analytics/recent-sessions?limit=${limit}`);
}

export interface JourneyFunnelStep {
  key: string;
  label: string;
  sessions: number;
  pctOfPrevious: number | null;
  pctOfLanding: number;
}

export interface VisitorJourneyFunnel {
  steps: JourneyFunnelStep[];
  bottleneckKey: string | null;
  repeatPurchase: { customers: number; totalCustomers: number; ratePct: number };
}

export function getJourneyFunnel(days?: number) {
  return apiFetch<VisitorJourneyFunnel>(`/api/analytics/journey-funnel${windowParams({ days })}`);
}

export interface SearchTrend {
  query: string;
  recentCount: number;
  priorCount: number;
  growthPct: number;
}

export function getSearchTrends(limit = 10) {
  return apiFetch<{ queries: SearchTrend[] }>(`/api/analytics/search-trends?limit=${limit}`);
}

export interface NoResultSearch {
  query: string;
  count: number;
  lastSearchedAt: string;
  suggestion: string | null;
}

export function getNoResultSearches(days?: number, limit = 20) {
  return apiFetch<{ queries: NoResultSearch[] }>(`/api/analytics/no-result-searches${windowParams({ days, limit })}`);
}

export interface SearchConversion {
  searchSessions: number;
  purchasedSessions: number;
  exitedSessions: number;
  purchaseRatePct: number;
  exitRatePct: number;
}

export function getSearchConversion(days?: number) {
  return apiFetch<SearchConversion>(`/api/analytics/search-conversion${windowParams({ days })}`);
}

export interface SearchAudience {
  devices: Array<{ device: string; sessions: number }>;
  loggedIn: number;
  guest: number;
}

export function getSearchAudience(days?: number) {
  return apiFetch<SearchAudience>(`/api/analytics/search-audience${windowParams({ days })}`);
}

export function getSearchesByCity(days?: number, limit = 10) {
  return apiFetch<{ cities: Array<{ city: string; sessions: number }> }>(`/api/analytics/searches-by-city${windowParams({ days, limit })}`);
}

export interface RankedProduct {
  id: string;
  name: string;
  slug: string;
  count: number;
}

export function getMostAddedToCart(days?: number, limit = 10) {
  return apiFetch<{ products: RankedProduct[] }>(`/api/analytics/most-added-to-cart${windowParams({ days, limit })}`);
}

export function getMostRemovedFromCart(days?: number, limit = 10) {
  return apiFetch<{ products: RankedProduct[] }>(`/api/analytics/most-removed-from-cart${windowParams({ days, limit })}`);
}

export function getMostWishlisted(limit = 10) {
  return apiFetch<{ products: RankedProduct[] }>(`/api/analytics/most-wishlisted?limit=${limit}`);
}

export interface ProductConversion {
  id: string;
  name: string;
  slug: string;
  views: number;
  orders: number;
  conversionRatePct: number;
}

export function getProductConversionRates(days?: number) {
  return apiFetch<{ products: ProductConversion[] }>(`/api/analytics/product-conversion${windowParams({ days })}`);
}

export interface ProductProfit {
  id: string;
  name: string;
  slug: string;
  revenue: number;
  cogs: number;
  profit: number;
}

export function getHighestProfitProducts(days?: number, limit = 10) {
  return apiFetch<{ products: ProductProfit[] }>(`/api/analytics/highest-profit-products${windowParams({ days, limit })}`);
}

export interface ProductRisk {
  id: string;
  name: string;
  slug: string;
  returnRatePct: number;
  refundRatePct: number;
  totalOrders: number;
}

export function getProductRiskMetrics(days?: number, limit = 10) {
  return apiFetch<{ products: ProductRisk[] }>(`/api/analytics/product-risk${windowParams({ days, limit })}`);
}

export interface FbtPair {
  productA: string;
  productB: string;
  coCount: number;
}

export function getFrequentlyBoughtTogetherPairs(days?: number, limit = 10) {
  return apiFetch<{ pairs: FbtPair[] }>(`/api/analytics/fbt-pairs${windowParams({ days, limit })}`);
}

export interface ProductSalesHeatmap {
  products: Array<{ id: string; name: string; totalQty: number }>;
  days: string[];
  cells: Record<string, Record<string, number>>;
}

export function getProductSalesHeatmap(days = 14, limit = 10) {
  return apiFetch<ProductSalesHeatmap>(`/api/analytics/product-sales-heatmap?days=${days}&limit=${limit}`);
}

export interface VariantPerformance {
  sku: string;
  productName: string;
  size: string;
  color: string;
  unitsSold: number;
  revenue: number;
}

export function getVariantPerformance(days?: number, limit = 10) {
  return apiFetch<{ variants: VariantPerformance[] }>(`/api/analytics/variant-performance${windowParams({ days, limit })}`);
}

export interface SizeColorPerformance {
  sizes: Array<{ value: string; unitsSold: number; revenue: number }>;
  colors: Array<{ value: string; unitsSold: number; revenue: number }>;
}

export function getSizeColorPerformance(days?: number) {
  return apiFetch<SizeColorPerformance>(`/api/analytics/size-color-performance${windowParams({ days })}`);
}

export interface InventoryTurnoverProduct {
  id: string;
  name: string;
  slug: string;
  cogsSold: number;
  inventoryValue: number;
  turnoverRatio: number;
}

export function getInventoryTurnover(days?: number, limit = 10) {
  return apiFetch<{ products: InventoryTurnoverProduct[] }>(`/api/analytics/inventory-turnover${windowParams({ days, limit })}`);
}

export interface CustomerRfmRow {
  id: string;
  name: string;
  recencyDays: number | null;
  frequency: number;
  monetary: number;
  tags: string[];
}

export function getCustomerRfmTable(limit = 50) {
  return apiFetch<{ customers: CustomerRfmRow[] }>(`/api/analytics/customer-rfm?limit=${limit}`);
}

export interface PurchaseFrequencyBucket {
  bucket: string;
  customers: number;
}

export function getPurchaseFrequencyDistribution() {
  return apiFetch<{ buckets: PurchaseFrequencyBucket[] }>("/api/analytics/purchase-frequency");
}

export interface PaymentMethodStat {
  method: string;
  orders: number;
  revenue: number;
}

export function getFavoritePaymentMethod(days?: number) {
  return apiFetch<{ methods: PaymentMethodStat[] }>(`/api/analytics/favorite-payment-method${windowParams({ days })}`);
}

export interface PurchaseTimeDistribution {
  byHour: Array<{ hour: number; orders: number }>;
  byDayOfWeek: Array<{ dow: number; orders: number }>;
}

export function getPurchaseTimeDistribution(days?: number) {
  return apiFetch<PurchaseTimeDistribution>(`/api/analytics/purchase-time${windowParams({ days })}`);
}

export interface CustomerLocationBreakdown {
  divisions: Array<{ division: string; orders: number; revenue: number }>;
  districts: Array<{ district: string; orders: number; revenue: number }>;
}

export function getCustomerLocationBreakdown(days?: number, limit = 10) {
  return apiFetch<CustomerLocationBreakdown>(`/api/analytics/customer-location${windowParams({ days, limit })}`);
}

// Section 7 — Marketing Intelligence

export interface CouponEffectiveness {
  code: string;
  type: string;
  orders: number;
  discountGiven: number;
  revenue: number;
}

export function getCouponEffectiveness(days?: number, limit = 10) {
  return apiFetch<{ coupons: CouponEffectiveness[] }>(`/api/analytics/coupon-effectiveness${windowParams({ days, limit })}`);
}

export interface BundlePerformance {
  name: string;
  orders: number;
  discountGiven: number;
  revenue: number;
}

export function getBundlePerformance(days?: number, limit = 10) {
  return apiFetch<{ bundles: BundlePerformance[] }>(`/api/analytics/bundle-performance${windowParams({ days, limit })}`);
}

export interface FlashSalePerformance {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  unitsSold: number;
  revenue: number;
}

export function getFlashSalePerformance(limit = 10) {
  return apiFetch<{ sales: FlashSalePerformance[] }>(`/api/analytics/flash-sale-performance${windowParams({ limit })}`);
}

export interface CampaignDeliveryStat {
  id: string;
  name: string;
  channel: string;
  sent: number;
  failed: number;
  pending: number;
  total: number;
}

export function getCampaignDeliveryStats(limit = 10) {
  return apiFetch<{ campaigns: CampaignDeliveryStat[] }>(`/api/analytics/campaign-delivery${windowParams({ limit })}`);
}

export interface LoyaltyPointsOverview {
  issued: number;
  redeemed: number;
  outstanding: number;
  customersWithBalance: number;
}

export function getLoyaltyPointsOverview() {
  return apiFetch<LoyaltyPointsOverview>("/api/analytics/loyalty-points");
}

// Section 8 — Sales Intelligence

export interface DiscountUsageBreakdown {
  totalOrders: number;
  ordersWithDiscount: number;
  discountedOrderRatePct: number;
  couponDiscountTotal: number;
  bundleDiscountTotal: number;
  subtotalTotal: number;
  discountRatePct: number;
}

export function getDiscountUsageBreakdown(days?: number) {
  return apiFetch<DiscountUsageBreakdown>(`/api/analytics/discount-usage${windowParams({ days })}`);
}

export interface ReturnRequestAnalytics {
  byTypeStatus: Array<{ type: string; status: string; count: number }>;
  topReasons: Array<{ reason: string; count: number }>;
}

export function getReturnRequestAnalytics(days?: number) {
  return apiFetch<ReturnRequestAnalytics>(`/api/analytics/return-request-analytics${windowParams({ days })}`);
}

export interface CourierPerformance {
  byStatus: Array<{ status: string; count: number }>;
  lossByReason: Array<{ reason: string; count: number; amount: number }>;
  totalLoss: number;
}

export function getCourierPerformance(days?: number) {
  return apiFetch<CourierPerformance>(`/api/analytics/courier-performance${windowParams({ days })}`);
}

// Section 9 — Financial Analytics

export interface ProfitTrendPoint {
  date: string;
  revenue: number;
  cogs: number;
  profit: number;
}

export function getProfitTrend(days = 30) {
  return apiFetch<{ series: ProfitTrendPoint[] }>(`/api/analytics/profit-trend${windowParams({ days })}`);
}

export interface FinancialCostBreakdown {
  refundCost: number;
  discountCost: number;
  courierLossCost: number;
  courierLossCount: number;
}

export function getFinancialCostBreakdown(days?: number) {
  return apiFetch<FinancialCostBreakdown>(`/api/analytics/financial-costs${windowParams({ days })}`);
}

export interface EstimatedTax {
  taxEnabled: boolean;
  defaultTaxRatePct: number;
  estimatedTax: number;
  revenue: number;
}

export function getEstimatedTax(days?: number) {
  return apiFetch<EstimatedTax>(`/api/analytics/estimated-tax${windowParams({ days })}`);
}

// Section 10 — Inventory Intelligence

export interface DeadStockVariant {
  productId: string;
  name: string;
  variantId: string;
  sku: string;
  size: string;
  color: string;
  stock: number;
  tiedUpValue: number;
}

export function getDeadStock(days = 90, limit = 10) {
  return apiFetch<{ variants: DeadStockVariant[] }>(`/api/analytics/dead-stock${windowParams({ days, limit })}`);
}

export interface StockMovementSummary {
  reason: string;
  movements: number;
  units: number;
}

export function getStockMovementSummary(days?: number) {
  return apiFetch<{ reasons: StockMovementSummary[] }>(`/api/analytics/stock-movement-summary${windowParams({ days })}`);
}

// Section 11 — Operational Analytics

export interface FulfillmentTime {
  avgHoursToShip: number | null;
  avgHoursShipToDeliver: number | null;
  avgHoursToDeliver: number | null;
  deliveredOrders: number;
}

export function getFulfillmentTime(days?: number) {
  return apiFetch<FulfillmentTime>(`/api/analytics/fulfillment-time${windowParams({ days })}`);
}

export interface AdminActivitySummary {
  byAdmin: Array<{ id: string; name: string; actions: number }>;
  byAction: Array<{ action: string; count: number }>;
}

export function getAdminActivitySummary(days?: number, limit = 10) {
  return apiFetch<AdminActivitySummary>(`/api/analytics/admin-activity${windowParams({ days, limit })}`);
}

// Section 12 — User Behavior

export interface WishlistConversion {
  totalWishlisted: number;
  converted: number;
  conversionRatePct: number;
}

export function getWishlistConversion(days?: number) {
  return apiFetch<WishlistConversion>(`/api/analytics/wishlist-conversion${windowParams({ days })}`);
}

export interface ReviewBehaviorStats {
  byRating: Array<{ rating: number; count: number }>;
  byStatus: Array<{ status: string; count: number; verified: number }>;
  avgRating: number;
}

export function getReviewBehaviorStats(days?: number) {
  return apiFetch<ReviewBehaviorStats>(`/api/analytics/review-behavior${windowParams({ days })}`);
}

export interface FeedbackVolume {
  total: number;
  read: number;
  unread: number;
}

export function getFeedbackVolume(days?: number) {
  return apiFetch<FeedbackVolume>(`/api/analytics/feedback-volume${windowParams({ days })}`);
}

// Section 14 — Lifetime Data

export interface LifetimeYearlyTrendPoint {
  year: number;
  orders: number;
  revenue: number;
}

export function getLifetimeYearlyTrend() {
  return apiFetch<{ years: LifetimeYearlyTrendPoint[] }>("/api/analytics/lifetime-yearly-trend");
}

// Section 15 — Reports (CSV export URLs — plain GET, admin session cookie carries auth, same
// pattern as downloadOrdersCsvUrl in admin-orders.ts)

export function downloadCustomerRfmCsvUrl() {
  return `${env.apiUrl}/api/analytics/export/customer-rfm.csv`;
}

export function downloadRevenueCsvUrl(days = 365) {
  return `${env.apiUrl}/api/analytics/export/revenue.csv?days=${days}`;
}

export function downloadInventoryTurnoverCsvUrl() {
  return `${env.apiUrl}/api/analytics/export/inventory-turnover.csv`;
}
