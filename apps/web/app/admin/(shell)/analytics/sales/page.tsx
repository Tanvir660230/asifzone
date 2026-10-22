"use client";

import { lazy } from "react";
import { AnalyticsTab } from "@/components/admin/analytics/analytics-tab";

const WhyView = lazy(() => import("@/components/admin/analytics/views/why-view"));
const SalesView = lazy(() => import("@/components/admin/analytics/views/sales-view"));
const FinancialView = lazy(() => import("@/components/admin/analytics/views/financial-view"));

export default function AnalyticsSalesPage() {
  return (
    <AnalyticsTab
      title="Sales"
      description="Orders, discounts, returns and courier performance — and what they earned."
      views={[
        { value: "sales", label: "Sales", Component: SalesView },
        { value: "why", label: "Why it changed", Component: WhyView },
        { value: "financial", label: "Profit", Component: FinancialView },
      ]}
    />
  );
}
