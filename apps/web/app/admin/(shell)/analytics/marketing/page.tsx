"use client";

import dynamic from "next/dynamic";
import { AnalyticsTab, AnalyticsViewSkeleton } from "@/components/admin/analytics/analytics-tab";

const MarketingView = dynamic(() => import("@/components/admin/analytics/views/marketing-view"), { loading: () => <AnalyticsViewSkeleton /> });
const VisitorsView = dynamic(() => import("@/components/admin/analytics/views/visitors-view"), { loading: () => <AnalyticsViewSkeleton /> });
const JourneyView = dynamic(() => import("@/components/admin/analytics/views/journey-view"), { loading: () => <AnalyticsViewSkeleton /> });

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
