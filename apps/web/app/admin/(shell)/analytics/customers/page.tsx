"use client";

import dynamic from "next/dynamic";
import { AnalyticsTab, AnalyticsViewSkeleton } from "@/components/admin/analytics/analytics-tab";

const CustomersView = dynamic(() => import("@/components/admin/analytics/views/customers-view"), { loading: () => <AnalyticsViewSkeleton /> });
const BehaviorView = dynamic(() => import("@/components/admin/analytics/views/behavior-view"), { loading: () => <AnalyticsViewSkeleton /> });

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
