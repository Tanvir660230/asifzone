"use client";

import { lazy } from "react";
import { AnalyticsTab } from "@/components/admin/analytics/analytics-tab";

const ActionsView = lazy(() => import("@/components/admin/analytics/views/actions-view"));
const ProductsView = lazy(() => import("@/components/admin/analytics/views/products-view"));
const InventoryView = lazy(() => import("@/components/admin/analytics/views/inventory-view"));
const SearchView = lazy(() => import("@/components/admin/analytics/views/search-view"));

export default function AnalyticsProductsPage() {
  return (
    <AnalyticsTab
      title="Products"
      description="What to do about each product, what sells, what sits on the shelf, and what shoppers search for."
      views={[
        { value: "actions", label: "To do", Component: ActionsView },
        { value: "products", label: "Products", Component: ProductsView },
        { value: "inventory", label: "Inventory", Component: InventoryView },
        { value: "search", label: "Search", Component: SearchView },
      ]}
    />
  );
}
