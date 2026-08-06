import { apiFetch } from "../api-client";

export interface DashboardSummary {
  revenue30d: number;
  orders30d: number;
  revenuePrev30d: number;
  ordersPrev30d: number;
  pendingOrders: number;
  lowStockCount: number;
  aov30d: number;
  aovPrev30d: number;
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
}

export interface LowStockVariant {
  id: string;
  sku: string;
  size: string;
  color: string;
  stock: number;
  product: { name: string; slug: string };
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
