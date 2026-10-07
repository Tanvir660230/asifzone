"use client";

import dynamic from "next/dynamic";
import { AnalyticsTab, AnalyticsViewSkeleton } from "@/components/admin/analytics/analytics-tab";

const OperationsView = dynamic(() => import("@/components/admin/analytics/views/operations-view"), { loading: () => <AnalyticsViewSkeleton /> });

export default function AnalyticsOperationsPage() {
  return (
    <AnalyticsTab
      title="Operations"
      description="Fulfilment speed and courier outcomes."
      views={[
        { value: "operations", label: "Operations", Component: OperationsView },
      ]}
    />
  );
}
