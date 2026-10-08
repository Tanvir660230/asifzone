"use client";

import { lazy } from "react";
import { AnalyticsTab } from "@/components/admin/analytics/analytics-tab";

const MarketingView = lazy(() => import("@/components/admin/analytics/views/marketing-view"));
const VisitorsView = lazy(() => import("@/components/admin/analytics/views/visitors-view"));
const JourneyView = lazy(() => import("@/components/admin/analytics/views/journey-view"));

export default function AnalyticsMarketingPage() {
  return (
    <AnalyticsTab
      title="Marketing"
      description="Where visitors come from, what they do, and what converts."
      views={[
        { value: "marketing", label: "Campaigns", Component: MarketingView },
        { value: "visitors", label: "Visitors", Component: VisitorsView },
        { value: "journey", label: "Journey", Component: JourneyView },
      ]}
    />
  );
}
