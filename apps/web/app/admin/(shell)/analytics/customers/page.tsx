"use client";

import { lazy } from "react";
import { AnalyticsTab } from "@/components/admin/analytics/analytics-tab";

const CustomersView = lazy(() => import("@/components/admin/analytics/views/customers-view"));
const BehaviorView = lazy(() => import("@/components/admin/analytics/views/behavior-view"));

export default function AnalyticsCustomersPage() {
  return (
    <AnalyticsTab
      title="Customers"
      description="Who buys, how often, and how they browse."
      views={[
        { value: "customers", label: "Customers", Component: CustomersView },
        { value: "behavior", label: "Behaviour", Component: BehaviorView },
      ]}
    />
  );
}
