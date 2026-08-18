import { apiFetch } from "../api-client";

export interface ExecutiveOverview {
  revenueToday: number;
  revenueYesterday: number;
  revenueThisWeek: number;
  revenueThisMonth: number;
  revenueLifetime: number;
  revenueGrowthPct: number;

  ordersLifetime: number;
  aovLifetime: number;

  grossProfitLifetime: number;
  profitGrowthPct: number;

  totalVisitors: number;
  returningVisitors: number;
  returningVisitorRatePct: number;

  conversionRatePct: number;
  customerLifetimeValue: number;
  repeatPurchaseRatePct: number;

  refundRatePct: number;
  returnRatePct: number;
  cancelledRatePct: number;

  inventoryValue: number;
  pendingPaymentsCount: number;
  pendingPaymentsAmount: number;
}

export function getExecutiveOverview() {
  return apiFetch<ExecutiveOverview>("/api/bi/overview");
}

export interface AutomatedInsight {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

export function getAutomatedInsights() {
  return apiFetch<{ insights: AutomatedInsight[] }>("/api/bi/automated-insights");
}
