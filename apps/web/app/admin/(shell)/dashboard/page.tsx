"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign,
  ShoppingBag,
  Clock,
  AlertTriangle,
  Percent,
  LogOut,
  Repeat,
  Heart,
  ShoppingCart,
  Search as SearchIcon,
  Target,
  Flame,
  Wallet,
  Truck,
  PhoneCall,
  Users,
  TrendingUp,
  PackageSearch,
  Timer,
  Radio,
  Smartphone,
  Chrome,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { PageHeader } from "@/components/admin/page-header";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { RevenueChart } from "@/components/admin/revenue-chart";
import { VisitorChart } from "@/components/admin/visitor-chart";
import { TrafficHeatmap } from "@/components/admin/traffic-heatmap";
import { TopProductsChart } from "@/components/admin/top-products-chart";
import { OrderStatusBreakdown } from "@/components/admin/order-status-breakdown";
import { LowStockTable } from "@/components/admin/low-stock-table";
import { SlowMovingTable } from "@/components/admin/slow-moving-table";
import { DemandForecastTable } from "@/components/admin/demand-forecast-table";
import { CohortRetentionGrid } from "@/components/admin/cohort-retention-grid";
import { RankedBarList } from "@/components/admin/ranked-bar-list";
import * as analyticsApi from "@/lib/api/admin-analytics";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { computeTrendPct, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type AnalyticsTab = "sales" | "catalog" | "marketing" | "customers";

const ANALYTICS_TABS: Array<{ id: AnalyticsTab; label: string }> = [
  { id: "sales", label: "Sales & Conversion" },
  { id: "catalog", label: "Catalog Performance" },
  { id: "marketing", label: "Marketing & Traffic" },
  { id: "customers", label: "Customer Insights" },
];

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export default function DashboardPage() {
  const { data: currentAdmin } = useCurrentAdmin();
  const [tab, setTab] = useState<AnalyticsTab>("sales");

  // Today's order-ops snapshot — moved here from the Orders page so that page stays focused on
  // the order table itself instead of losing its top third of scroll space to KPI tiles.
  const { data: orderStats } = useQuery({ queryKey: ["admin-order-stats"], queryFn: adminOrdersApi.getOrderStats });
  // Hidden (not shown as an error toast) whenever Steadfast isn't configured for this store —
  // getSteadfastBalance throws in that case, and a missing balance tile is a perfectly normal state.
  const { data: balanceData } = useQuery({
    queryKey: ["steadfast-balance"],
    queryFn: adminOrdersApi.getSteadfastBalance,
    retry: false,
    staleTime: 60_000,
  });

  // Hero — the "what needs my attention right now" set, always fetched on mount.
  const { data: summary } = useQuery({ queryKey: ["analytics-summary"], queryFn: analyticsApi.getSummary });
  const { data: revenue } = useQuery({ queryKey: ["analytics-revenue"], queryFn: () => analyticsApi.getRevenueSeries(30) });
  const { data: lowStock } = useQuery({ queryKey: ["analytics-low-stock"], queryFn: analyticsApi.getLowStock });
  // Polled every 30s so "on the site right now" actually stays current — the endpoint itself is
  // only cached 15s server-side, so this doesn't just keep re-reading a stale number.
  const { data: activeVisitors } = useQuery({
    queryKey: ["analytics-active-visitors"],
    queryFn: analyticsApi.getActiveVisitors,
    refetchInterval: 30_000,
  });

  // Deeper analytics — gated to the active tab so a phone doesn't pull all 13 endpoints just to
  // render the default view. React Query caches per queryKey, so revisiting a tab within its
  // staleTime doesn't re-fetch.
  const { data: statusCounts } = useQuery({
    queryKey: ["analytics-status"],
    queryFn: analyticsApi.getOrderStatusCounts,
    enabled: tab === "sales",
  });
  const { data: topProducts } = useQuery({
    queryKey: ["analytics-top-products"],
    queryFn: () => analyticsApi.getTopProducts(30, 5),
    enabled: tab === "sales",
  });
  const { data: funnel } = useQuery({
    queryKey: ["analytics-funnel"],
    queryFn: () => analyticsApi.getConversionFunnel(30),
    enabled: tab === "sales",
  });

  const { data: mostViewed } = useQuery({
    queryKey: ["analytics-most-viewed"],
    queryFn: () => analyticsApi.getMostViewedProducts(30, 8),
    enabled: tab === "catalog",
  });
  const { data: topCategories } = useQuery({
    queryKey: ["analytics-top-categories"],
    queryFn: () => analyticsApi.getTopCategories(30, 8),
    enabled: tab === "catalog",
  });
  const { data: topBrands } = useQuery({
    queryKey: ["analytics-top-brands"],
    queryFn: () => analyticsApi.getTopBrands(30, 8),
    enabled: tab === "catalog",
  });
  const { data: trendingProducts } = useQuery({
    queryKey: ["analytics-trending-products"],
    queryFn: () => analyticsApi.getTrendingProducts(8),
    enabled: tab === "catalog",
  });
  const { data: bestSellingPrediction } = useQuery({
    queryKey: ["analytics-best-selling-prediction"],
    queryFn: () => analyticsApi.getBestSellingPrediction(8),
    enabled: tab === "catalog",
  });
  const { data: slowMoving } = useQuery({
    queryKey: ["analytics-slow-moving"],
    queryFn: () => analyticsApi.getSlowMovingProducts(30, 8),
    enabled: tab === "catalog",
  });
  const { data: demandForecast } = useQuery({
    queryKey: ["analytics-demand-forecast"],
    queryFn: () => analyticsApi.getDemandForecast(14, 8),
    enabled: tab === "catalog",
  });

  const { data: visitors } = useQuery({
    queryKey: ["analytics-visitors"],
    queryFn: () => analyticsApi.getVisitorSeries(30),
    enabled: tab === "marketing",
  });
  const { data: trafficSources } = useQuery({
    queryKey: ["analytics-traffic-sources"],
    queryFn: () => analyticsApi.getTrafficSources(30, 8),
    enabled: tab === "marketing",
  });
  const { data: campaigns } = useQuery({
    queryKey: ["analytics-campaigns"],
    queryFn: () => analyticsApi.getCampaignPerformance(30, 8),
    enabled: tab === "marketing",
  });
  const { data: search } = useQuery({
    queryKey: ["analytics-search"],
    queryFn: () => analyticsApi.getSearchAnalytics(30, 8),
    enabled: tab === "marketing",
  });
  const { data: heatmap } = useQuery({
    queryKey: ["analytics-traffic-heatmap"],
    queryFn: () => analyticsApi.getTrafficHeatmap(30),
    enabled: tab === "marketing",
  });
  const { data: devices } = useQuery({
    queryKey: ["analytics-devices"],
    queryFn: () => analyticsApi.getDeviceBreakdown(30),
    enabled: tab === "marketing",
  });
  const { data: browsers } = useQuery({
    queryKey: ["analytics-browsers"],
    queryFn: () => analyticsApi.getBrowserBreakdown(30),
    enabled: tab === "marketing",
  });

  const { data: customerInsights } = useQuery({
    queryKey: ["analytics-customer-insights"],
    queryFn: analyticsApi.getCustomerInsights,
    enabled: tab === "customers",
  });
  const { data: cartAbandonment } = useQuery({
    queryKey: ["analytics-cart-abandonment"],
    queryFn: analyticsApi.getCartAbandonment,
    enabled: tab === "customers",
  });
  const { data: cohorts } = useQuery({
    queryKey: ["analytics-cohort-retention"],
    queryFn: analyticsApi.getCohortRetention,
    enabled: tab === "customers",
  });

  const heatmapEnabled = Boolean(process.env.NEXT_PUBLIC_CLARITY_ID);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={currentAdmin ? `Welcome back, ${firstName(currentAdmin.admin.name)}.` : undefined}
      />

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Today — needs action</p>
        <div
          className={cn(
            "grid grid-cols-2 gap-4 lg:grid-cols-6",
            orderStats && balanceData && "xl:grid-cols-7",
          )}
        >
          <StatTile
            label="On site right now"
            value={activeVisitors ? String(activeVisitors.count) : "—"}
            icon={<Radio size={22} />}
            tone={activeVisitors && activeVisitors.count > 0 ? "accent" : "default"}
          />
          {orderStats ? (
            <>
              <StatTile label="Today's orders" value={String(orderStats.todayOrders)} icon={<ShoppingBag size={22} />} />
              <StatTile
                label="Today's revenue"
                value={formatPrice(orderStats.todayRevenue)}
                icon={<Wallet size={22} />}
                tone="accent"
              />
              <StatTile label="Pending" value={String(orderStats.pending)} icon={<Clock size={22} />} />
              <StatTile
                label="Needs attention"
                value={String(orderStats.needsAttention)}
                icon={<AlertTriangle size={22} />}
                tone={orderStats.needsAttention > 0 ? "warning" : "default"}
              />
              <StatTile
                label="Follow-up due"
                value={String(orderStats.followUpDue)}
                icon={<PhoneCall size={22} />}
                tone={orderStats.followUpDue > 0 ? "warning" : "default"}
              />
              {balanceData && (
                <StatTile
                  label="Steadfast balance"
                  value={formatPrice(balanceData.balance)}
                  icon={<Truck size={22} />}
                  tone="accent"
                />
              )}
            </>
          ) : (
            <>
              <StatTileSkeleton />
              <StatTileSkeleton />
              <StatTileSkeleton />
              <StatTileSkeleton />
              <StatTileSkeleton />
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Last 30 days</p>
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
          <StatTile
            label="Unique visitors (30d)"
            value={summary ? String(summary.uniqueVisitors30d) : "—"}
            icon={<Users size={22} />}
            trendPct={summary ? computeTrendPct(summary.uniqueVisitors30d, summary.uniqueVisitorsPrev30d) : undefined}
          />
          <StatTile
            label="Low stock items"
            value={summary ? String(summary.lowStockCount) : "—"}
            icon={<AlertTriangle size={22} />}
            tone={summary && summary.lowStockCount > 0 ? "warning" : "default"}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue — last 30 days</CardTitle>
        </CardHeader>
        <CardContent>{revenue && <RevenueChart data={revenue.series} />}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Low stock</CardTitle>
        </CardHeader>
        <CardContent>{lowStock && <LowStockTable variants={lowStock.variants} />}</CardContent>
      </Card>

      <div>
        <div className="mb-4 flex items-center gap-1 overflow-x-auto border-b border-ink-100">
          {ANALYTICS_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                tab === t.id ? "border-ink-900 text-ink-900" : "border-transparent text-ink-400 hover:text-ink-600",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "sales" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile
                label="Avg order value (30d)"
                value={summary ? formatPrice(summary.aov30d) : "—"}
                icon={<DollarSign size={22} />}
                trendPct={summary ? computeTrendPct(summary.aov30d, summary.aovPrev30d) : undefined}
              />
              <StatTile
                label="Conversion rate (30d)"
                value={funnel ? `${funnel.conversionRate.toFixed(1)}%` : "—"}
                icon={<Percent size={22} />}
              />
              <StatTile label="Bounce rate (30d)" value={funnel ? `${funnel.bounceRate.toFixed(1)}%` : "—"} icon={<LogOut size={22} />} />
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Most purchased products (30d)</CardTitle>
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
          </div>
        )}

        {tab === "catalog" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Most viewed products (30d)</CardTitle>
              </CardHeader>
              <CardContent>
                {mostViewed && (
                  <RankedBarList
                    emptyLabel="No product views logged yet."
                    items={mostViewed.products.map((p) => ({
                      key: p.id,
                      label: p.name,
                      value: p.views,
                      valueLabel: `${p.views} view${p.views === 1 ? "" : "s"}`,
                    }))}
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top categories (30d)</CardTitle>
              </CardHeader>
              <CardContent>
                {topCategories && (
                  <RankedBarList
                    emptyLabel="No sales in this period yet."
                    items={topCategories.categories.map((c) => ({
                      key: c.name,
                      label: c.name,
                      value: c.revenue,
                      valueLabel: formatPrice(c.revenue),
                      subLabel: `${c.quantitySold} sold`,
                    }))}
                  />
                )}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Top brands (30d)</CardTitle>
              </CardHeader>
              <CardContent>
                {topBrands && (
                  <RankedBarList
                    emptyLabel="No sales in this period yet."
                    items={topBrands.brands.map((b) => ({
                      key: b.name,
                      label: b.name,
                      value: b.revenue,
                      valueLabel: formatPrice(b.revenue),
                      subLabel: `${b.quantitySold} sold`,
                    }))}
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp size={16} className="text-brass-500" /> Trending products (this week vs. last)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trendingProducts && (
                  <RankedBarList
                    emptyLabel="No product views logged this week yet."
                    items={trendingProducts.products.map((p) => ({
                      key: p.id,
                      label: p.name,
                      value: p.recentViews,
                      valueLabel: `${p.recentViews} views (${p.growthPct >= 0 ? "+" : ""}${p.growthPct.toFixed(0)}%)`,
                      subLabel: `prior week: ${p.priorViews} views`,
                    }))}
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp size={16} className="text-brass-500" /> Best-selling prediction (week-over-week)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {bestSellingPrediction && (
                  <RankedBarList
                    emptyLabel="Not enough recent sales to project a trend."
                    items={bestSellingPrediction.products.map((p) => ({
                      key: p.name,
                      label: p.name,
                      value: p.recentUnits,
                      valueLabel: `${p.recentUnits} sold (${p.growthPct >= 0 ? "+" : ""}${p.growthPct.toFixed(0)}%)`,
                      subLabel: `prior week: ${p.priorUnits} sold`,
                    }))}
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PackageSearch size={16} className="text-ink-400" /> Slow-moving stock (30d)
                </CardTitle>
              </CardHeader>
              <CardContent>{slowMoving && <SlowMovingTable products={slowMoving.products} />}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Timer size={16} className="text-danger-500" /> Stockout risk (next 14 days)
                </CardTitle>
              </CardHeader>
              <CardContent>{demandForecast && <DemandForecastTable variants={demandForecast.variants} />}</CardContent>
            </Card>
          </div>
        )}

        {tab === "marketing" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <StatTile label="Searches (30d)" value={search ? String(search.totalSearches) : "—"} icon={<SearchIcon size={22} />} />
              <StatTile
                label="Zero-result searches"
                value={search ? `${search.zeroResultRate.toFixed(1)}%` : "—"}
                icon={<Target size={22} />}
                tone={search && search.zeroResultRate > 20 ? "warning" : "default"}
              />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Visitors — last 30 days</CardTitle>
              </CardHeader>
              <CardContent>{visitors && <VisitorChart data={visitors.series} />}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>When visitors show up (Bangladesh time, 30d)</CardTitle>
              </CardHeader>
              <CardContent>{heatmap && <TrafficHeatmap cells={heatmap.cells} />}</CardContent>
            </Card>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Smartphone size={16} className="text-ink-400" /> Devices (30d)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {devices && (
                    <RankedBarList
                      emptyLabel="No pageview data yet."
                      items={devices.devices.map((d) => ({
                        key: d.device,
                        label: d.device,
                        value: d.sessions,
                        valueLabel: `${d.sessions} session${d.sessions === 1 ? "" : "s"}`,
                      }))}
                    />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Chrome size={16} className="text-ink-400" /> Browsers (30d)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {browsers && (
                    <RankedBarList
                      emptyLabel="No pageview data yet."
                      items={browsers.browsers.map((b) => ({
                        key: b.browser,
                        label: b.browser,
                        value: b.sessions,
                        valueLabel: `${b.sessions} session${b.sessions === 1 ? "" : "s"}`,
                      }))}
                    />
                  )}
                </CardContent>
              </Card>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Traffic sources (30d)</CardTitle>
                </CardHeader>
                <CardContent>
                  {trafficSources && (
                    <RankedBarList
                      emptyLabel="No pageview data yet."
                      items={trafficSources.sources.map((s) => ({
                        key: s.source,
                        label: s.source,
                        value: s.sessions,
                        valueLabel: `${s.sessions} session${s.sessions === 1 ? "" : "s"}`,
                      }))}
                    />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Campaign performance (30d)</CardTitle>
                </CardHeader>
                <CardContent>
                  {campaigns && (
                    <RankedBarList
                      emptyLabel="No utm_campaign-tagged traffic converted yet."
                      items={campaigns.campaigns.map((c) => ({
                        key: c.campaign,
                        label: c.campaign,
                        value: c.revenue,
                        valueLabel: formatPrice(c.revenue),
                        subLabel: `${c.orders} order${c.orders === 1 ? "" : "s"}`,
                      }))}
                    />
                  )}
                </CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Top search queries (30d)</CardTitle>
                </CardHeader>
                <CardContent>
                  {search && (
                    <RankedBarList
                      emptyLabel="No searches logged yet."
                      items={search.topQueries.map((q) => ({
                        key: q.query,
                        label: q.query,
                        value: q.count,
                        valueLabel: `${q.count}×`,
                      }))}
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {tab === "customers" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile
                label="Returning customers"
                value={customerInsights ? `${customerInsights.returningRate.toFixed(1)}%` : "—"}
                icon={<Repeat size={22} />}
              />
              <StatTile
                label="Avg customer lifetime value"
                value={customerInsights ? formatPrice(customerInsights.avgClv) : "—"}
                icon={<Heart size={22} />}
              />
              <StatTile
                label="Abandoned carts"
                value={cartAbandonment ? `${cartAbandonment.cartCount} · ${formatPrice(cartAbandonment.potentialRevenue)}` : "—"}
                icon={<ShoppingCart size={22} />}
                tone={cartAbandonment && cartAbandonment.cartCount > 0 ? "warning" : "default"}
              />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Cohort retention — do new customers come back?</CardTitle>
              </CardHeader>
              <CardContent>{cohorts && <CohortRetentionGrid cohorts={cohorts.cohorts} />}</CardContent>
            </Card>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="flex items-center gap-3 py-4 text-sm text-ink-600">
          <Flame size={18} className="shrink-0 text-brass-500" />
          {heatmapEnabled ? (
            <span>Heatmap/session recording is active via Microsoft Clarity.</span>
          ) : (
            <span>
              Heatmap tracking is wired up but not turned on — set{" "}
              <code className="rounded bg-ink-100 px-1 py-0.5 text-xs">NEXT_PUBLIC_CLARITY_ID</code> (a free{" "}
              <a href="https://clarity.microsoft.com" target="_blank" rel="noreferrer" className="underline">
                Microsoft Clarity
              </a>{" "}
              project id) at build time to enable click/scroll heatmaps and session recordings.
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
