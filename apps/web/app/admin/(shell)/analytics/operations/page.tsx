"use client";

import { lazy } from "react";
import { AnalyticsTab } from "@/components/admin/analytics/analytics-tab";

const PulseView = lazy(() => import("@/components/admin/analytics/views/pulse-view"));
const DeliveriesView = lazy(() => import("@/components/admin/analytics/views/deliveries-view"));
const OperationsView = lazy(() => import("@/components/admin/analytics/views/operations-view"));

export default function AnalyticsOperationsPage() {
  return (
    <AnalyticsTab
      title="Operations"
      description="Each day's orders, parcels and deliveries against other days, and how fast orders move."
      views={[
        { value: "pulse", label: "Daily pulse", Component: PulseView },
        { value: "deliveries", label: "Deliveries", Component: DeliveriesView },
        { value: "operations", label: "Speed & staff", Component: OperationsView },
      ]}
    />
  );
}
