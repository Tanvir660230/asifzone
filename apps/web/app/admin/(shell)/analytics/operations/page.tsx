"use client";

import { lazy } from "react";
import { AnalyticsTab } from "@/components/admin/analytics/analytics-tab";

const OperationsView = lazy(() => import("@/components/admin/analytics/views/operations-view"));

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
