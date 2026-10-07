"use client";

import dynamic from "next/dynamic";
import { AnalyticsTab, AnalyticsViewSkeleton } from "@/components/admin/analytics/analytics-tab";

const SalesView = dynamic(() => import("@/components/admin/analytics/views/sales-view"), { loading: () => <AnalyticsViewSkeleton /> });
const FinancialView = dynamic(() => import("@/components/admin/analytics/views/financial-view"), { loading: () => <AnalyticsViewSkeleton /> });

export default function AnalyticsSalesPage() {
  return (
    <AnalyticsTab
      title="Sales"
      description="Orders, discounts, returns and courier performance — and what they earned."
      views={[
        { value: "sales", label: "Sales", Component: SalesView },
        { value: "financial", label: "Profit", Component: FinancialView },
      ]}
    />
  );
}
