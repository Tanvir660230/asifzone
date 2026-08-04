import { apiFetch } from "../api-client";

export interface DashboardSummary {
  revenue30d: number;
  orders30d: number;
  revenuePrev30d: number;
  ordersPrev30d: number;
  pendingOrders: number;
  lowStockCount: number;
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
