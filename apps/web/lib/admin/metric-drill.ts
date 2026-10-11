import type { MetricGrouping } from "@clothing-brand/shared";

/**
 * Where one group of a metric drill-down leads (Blueprint V2 P6: "drill-down uses the registry's groupBy and links to
 * filtered lists through href builders"). Null when the group has no page of its own (guest, unattributed, a brand).
 * Order lists filter by placement date — for a realised metric that's the closest list, not an exact reconciliation.
 */
export function metricDrillHref(grouping: MetricGrouping, key: string): string | null {
  switch (grouping) {
    case "day":
      return `/admin/orders?from=${key}&to=${key}`;
    case "month": {
      const [y, m] = key.split("-").map(Number);
      if (!y || !m) return null;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return `/admin/orders?from=${key}-01&to=${key}-${String(last).padStart(2, "0")}`;
    }
    case "year":
      return `/admin/orders?from=${key}-01-01&to=${key}-12-31`;
    case "payment_method":
      return `/admin/orders?f.method=${encodeURIComponent(key)}`;
    case "product":
      return key.startsWith("unattributed") ? null : `/admin/products/${key}/edit`;
    case "customer":
      return key === "guest" ? null : `/admin/customers/${key}`;
    case "category":
      return key === "uncategorized" || key.startsWith("not") ? null : `/admin/products?f.category=${key}`;
    case "brand":
      return null;
  }
}

export const GROUPING_LABEL: Record<MetricGrouping, string> = {
  day: "Day",
  month: "Month",
  year: "Year",
  payment_method: "Payment method",
  product: "Product",
  category: "Category",
  brand: "Brand",
  customer: "Customer",
};
