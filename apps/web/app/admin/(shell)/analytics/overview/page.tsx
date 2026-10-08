"use client";

import { lazy } from "react";
import { AnalyticsTab } from "@/components/admin/analytics/analytics-tab";

const OverviewView = lazy(() => import("@/components/admin/analytics/views/overview-view"));
const AiInsightsView = lazy(() => import("@/components/admin/analytics/views/ai-insights-view"));
const LifetimeView = lazy(() => import("@/components/admin/analytics/views/lifetime-view"));
const ReportsView = lazy(() => import("@/components/admin/analytics/views/reports-view"));

export default function AnalyticsOverviewPage() {
  return (
    <AnalyticsTab
      title="Overview"
      description="The business at a glance for the report period."
      views={[
        { value: "overview", label: "Overview", Component: OverviewView },
        { value: "insights", label: "AI insights", Component: AiInsightsView },
        { value: "lifetime", label: "Lifetime", Component: LifetimeView },
        { value: "reports", label: "Reports", Component: ReportsView },
      ]}
    />
  );
}
