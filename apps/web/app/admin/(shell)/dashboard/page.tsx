"use client";

import { useQuery } from "@tanstack/react-query";
import { DollarSign, ShoppingBag, Clock, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/admin/stat-tile";
import { PageHeader } from "@/components/admin/page-header";
import { RevenueChart } from "@/components/admin/revenue-chart";
import { TopProductsChart } from "@/components/admin/top-products-chart";
import { OrderStatusBreakdown } from "@/components/admin/order-status-breakdown";
import { LowStockTable } from "@/components/admin/low-stock-table";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { computeTrendPct, formatPrice } from "@/lib/format";

export default function DashboardPage() {
  const { data: summary } = useQuery({ queryKey: ["analytics-summary"], queryFn: analyticsApi.getSummary });
  const { data: revenue } = useQuery({ queryKey: ["analytics-revenue"], queryFn: () => analyticsApi.getRevenueSeries(30) });
  const { data: statusCounts } = useQuery({ queryKey: ["analytics-status"], queryFn: analyticsApi.getOrderStatusCounts });
  const { data: topProducts } = useQuery({ queryKey: ["analytics-top-products"], queryFn: () => analyticsApi.getTopProducts(30, 5) });
  const { data: lowStock } = useQuery({ queryKey: ["analytics-low-stock"], queryFn: analyticsApi.getLowStock });

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Revenue (30d)"
          value={summary ? formatPrice(summary.revenue30d) : "—"}
          icon={<DollarSign size={22} />}
          trendPct={summary ? computeTrendPct(summary.revenue30d, summary.revenuePrev30d) : undefined}
        />
        <StatTile
          label="Orders (30d)"
          value={summary ? String(summary.orders30d) : "—"}
          icon={<ShoppingBag size={22} />}
          trendPct={summary ? computeTrendPct(summary.orders30d, summary.ordersPrev30d) : undefined}
        />
        <StatTile label="Pending orders" value={summary ? String(summary.pendingOrders) : "—"} icon={<Clock size={22} />} />
        <StatTile
          label="Low stock items"
          value={summary ? String(summary.lowStockCount) : "—"}
          icon={<AlertTriangle size={22} />}
          tone={summary && summary.lowStockCount > 0 ? "warning" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue — last 30 days</CardTitle>
        </CardHeader>
        <CardContent>{revenue && <RevenueChart data={revenue.series} />}</CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top products (30d)</CardTitle>
          </CardHeader>
          <CardContent>{topProducts && <TopProductsChart products={topProducts.products} />}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orders by status</CardTitle>
          </CardHeader>
          <CardContent>{statusCounts && <OrderStatusBreakdown counts={statusCounts.counts} />}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Low stock</CardTitle>
        </CardHeader>
        <CardContent>{lowStock && <LowStockTable variants={lowStock.variants} />}</CardContent>
      </Card>
    </div>
  );
}
