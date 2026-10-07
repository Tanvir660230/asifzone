"use client";

import dynamic from "next/dynamic";
import { AnalyticsTab, AnalyticsViewSkeleton } from "@/components/admin/analytics/analytics-tab";

const ProductsView = dynamic(() => import("@/components/admin/analytics/views/products-view"), { loading: () => <AnalyticsViewSkeleton /> });
const InventoryView = dynamic(() => import("@/components/admin/analytics/views/inventory-view"), { loading: () => <AnalyticsViewSkeleton /> });
const SearchView = dynamic(() => import("@/components/admin/analytics/views/search-view"), { loading: () => <AnalyticsViewSkeleton /> });

export default function AnalyticsProductsPage() {
  return (
    <AnalyticsTab
      title="Products"
      description="What sells, what sits on the shelf, and what shoppers search for."
      views={[
        { value: "products", label: "Products", Component: ProductsView },
        { value: "inventory", label: "Inventory", Component: InventoryView },
        { value: "search", label: "Search", Component: SearchView },
      ]}
    />
  );
}
