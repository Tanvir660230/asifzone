"use client";

import dynamic from "next/dynamic";
import { AnalyticsTab, AnalyticsViewSkeleton } from "@/components/admin/analytics/analytics-tab";

const OverviewView = dynamic(() => import("@/components/admin/analytics/views/overview-view"), { loading: () => <AnalyticsViewSkeleton /> });
const AiInsightsView = dynamic(() => import("@/components/admin/analytics/views/ai-insights-view"), { loading: () => <AnalyticsViewSkeleton /> });
const LifetimeView = dynamic(() => import("@/components/admin/analytics/views/lifetime-view"), { loading: () => <AnalyticsViewSkeleton /> });
const ReportsView = dynamic(() => import("@/components/admin/analytics/views/reports-view"), { loading: () => <AnalyticsViewSkeleton /> });

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
