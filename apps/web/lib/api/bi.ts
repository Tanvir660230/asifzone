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
  grossProfitCostedLinesLifetime: number;
  grossProfitUncostedLinesLifetime: number;

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

  // Phase 5 — registry metrics (docs/METRICS_REGISTRY.md): the D1 breakdown for the business month, and ledger positions.
  grossMerchandiseThisMonth: number;
  discountsThisMonth: number;
  shippingThisMonth: number;
  returnsThisMonth: number;
  refundsThisMonth: number;
  collectedCashThisMonth: number;
  taxThisMonth: number;
  taxUnrecordedOrdersThisMonth: number;
  merchandiseVatThisMonth: number;
  merchandiseVatUnrecordedOrdersThisMonth: number;
  merchandiseRefundsThisMonth: number;
  overpaymentRefundsThisMonth: number;
  netSalesInclShippingThisMonth: number;
  outstandingCod: number;
  refundDue: number;
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
