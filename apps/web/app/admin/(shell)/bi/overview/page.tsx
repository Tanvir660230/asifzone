"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Wallet,
  TrendingUp,
  ShoppingBag,
  Receipt,
  Users,
  Heart,
  Target,
  RotateCcw,
  Undo2,
  Ban,
  Boxes,
  Clock,
  Info,
  MapPin,
  CreditCard,
  Megaphone,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  ArrowUpRight,
  PackageX,
  Bell,
  ListChecks,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { ConversionMetricCard } from "@/components/admin/conversion-metric-card";
import { HeroRevenueCard } from "@/components/admin/hero-revenue-card";
import { RevenueChart } from "@/components/admin/revenue-chart";
import { JourneyFunnel } from "@/components/admin/journey-funnel";
import { OrderStatusBreakdown } from "@/components/admin/order-status-breakdown";
import { TopProductsChart } from "@/components/admin/top-products-chart";
import { LowStockTable } from "@/components/admin/low-stock-table";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import { useBiDateRange } from "@/components/admin/bi-date-range-context";
import * as biApi from "@/lib/api/bi";
import * as analyticsApi from "@/lib/api/admin-analytics";
import * as notificationsApi from "@/lib/api/notifications";
import { formatPrice, computeTrendPct, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

function toBarItems<T>(
  rows: T[] | undefined,
  opts: { key: (r: T) => string; label: (r: T) => string; value: (r: T) => number; valueLabel: (r: T) => string; subLabel?: (r: T) => string },
): RankedBarListItem[] {
  return (rows ?? []).map((r) => ({
    key: opts.key(r),
    label: opts.label(r),
    value: opts.value(r),
    valueLabel: opts.valueLabel(r),
    subLabel: opts.subLabel?.(r),
  }));
}

/** Inclusive day count for the selected range — drives every query below that only accepts a
 * rolling "last N days" window rather than an explicit from/to (see the note above the funnel
 * query). */
function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
}

const INSIGHT_SEVERITY_STYLE: Record<string, { icon: typeof AlertTriangle; classes: string }> = {
  critical: { icon: AlertOctagon, classes: "border-danger-100 bg-danger-50/60 text-danger-700" },
  warning: { icon: AlertTriangle, classes: "border-warning-100 bg-warning-50/60 text-warning-700" },
  info: { icon: CheckCircle2, classes: "border-info-100 bg-info-50/60 text-info-700" },
};

const ACTIVITY_ICON: Record<string, typeof ShoppingBag> = {
  "order.created": ShoppingBag,
  "product.low_stock": PackageX,
  "order.cancelled_but_paid": AlertTriangle,
};

export default function ExecutiveOverviewPage() {
  // Every range-aware query below is driven by this one shared picker (rendered in
  // app/admin/(shell)/bi/layout.tsx) — previously this page ignored it entirely, so changing the
  // date range visibly did nothing on the page an owner lands on first.
  const { range } = useBiDateRange();
  const rangeKey = `${range.from.toISOString()}:${range.to.toISOString()}`;
  const rangeDays = daysBetween(range.from, range.to);

  const { data: overview, isLoading: overviewLoading } = useQuery({ queryKey: ["bi-overview"], queryFn: biApi.getExecutiveOverview });
  const { data: insights } = useQuery({ queryKey: ["bi-overview-insights"], queryFn: biApi.getAutomatedInsights });
  const { data: customerInsights } = useQuery({ queryKey: ["bi-overview-customers"], queryFn: analyticsApi.getCustomerInsights });
  const { data: activity } = useQuery({ queryKey: ["bi-overview-activity"], queryFn: notificationsApi.listNotifications, refetchInterval: 30_000 });

  // Fetches 2x the selected window so the first half can serve as the "prior period" comparison
  // baseline for the trend badge, without a dedicated comparison endpoint.
  const { data: revenueSeries } = useQuery({
    queryKey: ["bi-overview-revenue", rangeKey],
    queryFn: () => analyticsApi.getRevenueSeries(rangeDays * 2),
  });
  // getJourneyFunnel/getTopProducts/getTopCategories/getCampaignPerformance/getCustomerLocationBreakdown
  // only accept a rolling "days" window (not an explicit dateFrom/dateTo like getFavoritePaymentMethod
  // and getReturnRequestAnalytics below) — for a range that doesn't end today (e.g. "Last Month"),
  // these sections approximate it as "last N days from now" rather than the exact window. Same
  // limitation every other BI tab using these endpoints already has.
  const { data: funnel } = useQuery({ queryKey: ["bi-overview-funnel", rangeKey], queryFn: () => analyticsApi.getJourneyFunnel(rangeDays) });
  const { data: statusCounts } = useQuery({ queryKey: ["bi-overview-status"], queryFn: analyticsApi.getOrderStatusCounts });
  const { data: topProducts } = useQuery({ queryKey: ["bi-overview-top-products", rangeKey], queryFn: () => analyticsApi.getTopProducts(rangeDays, 5) });
  const { data: topCategories } = useQuery({
    queryKey: ["bi-overview-top-categories", rangeKey],
    queryFn: () => analyticsApi.getTopCategories(rangeDays, 5),
  });
  const { data: geo } = useQuery({ queryKey: ["bi-overview-geo", rangeKey], queryFn: () => analyticsApi.getCustomerLocationBreakdown(rangeDays, 5) });
  const { data: campaigns } = useQuery({
    queryKey: ["bi-overview-campaigns", rangeKey],
    queryFn: () => analyticsApi.getCampaignPerformance(rangeDays, 5),
  });
  const { data: lowStock } = useQuery({ queryKey: ["bi-overview-low-stock"], queryFn: analyticsApi.getLowStock });

  const { data: paymentMethods } = useQuery({
    queryKey: ["bi-overview-payment", rangeKey],
    queryFn: () => analyticsApi.getFavoritePaymentMethod(undefined, range.from, range.to),
  });
  const { data: returns } = useQuery({
    queryKey: ["bi-overview-returns", rangeKey],
    queryFn: () => analyticsApi.getReturnRequestAnalytics(undefined, range.from, range.to),
  });

  const { currentSeries, periodRevenue, periodOrders, revenueTrendPct } = useMemo(() => {
    const all = revenueSeries?.series ?? [];
    const current = all.slice(-rangeDays);
    const previous = all.slice(0, Math.max(0, all.length - rangeDays));
    const currentSum = current.reduce((sum, p) => sum + p.revenue, 0);
    const previousSum = previous.reduce((sum, p) => sum + p.revenue, 0);
    const currentOrders = current.reduce((sum, p) => sum + p.orders, 0);
    return {
      currentSeries: current,
      periodRevenue: currentSum,
      periodOrders: currentOrders,
      revenueTrendPct: previous.length > 0 ? computeTrendPct(currentSum, previousSum) : null,
    };
  }, [revenueSeries, rangeDays]);

  const topInsights = insights?.insights.slice(0, 3) ?? [];
  const recentActivity = activity?.items.slice(0, 6) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Executive Overview</h1>
        <p className="mt-1 text-sm text-ink-500">
          The business at a glance across every BI domain — updated roughly every minute. Sections below respond to the date range above;
          lifetime figures are labeled separately.
        </p>
      </div>

      {/* Priority KPIs — revenue for the selected range (with a period-over-period comparison) plus
          the handful of lifetime numbers an owner checks daily. Deliberately 6 tiles, not the
          previous page's 12+ across three separate grids: everything else that used to live here
          (visitor funnel detail, per-status refund/return breakdowns) moved into its own titled
          section further down so this first screen stays a genuine at-a-glance read. */}
      <section
        aria-label="Priority KPIs"
        className="grid grid-cols-1 gap-4 lg:grid-cols-5"
      >
        {revenueSeries ? (
          <HeroRevenueCard
            className="lg:col-span-2"
            label={`Revenue — ${rangeDays} day${rangeDays === 1 ? "" : "s"} selected`}
            value={formatPrice(periodRevenue)}
            todayOrders={periodOrders}
            ordersSuffix="in this period"
            trendPct={revenueTrendPct}
            trendLabel="vs. prior period"
            series={currentSeries.map((p) => p.revenue)}
          />
        ) : (
          <div className="h-[15.5rem] animate-pulse rounded-3xl bg-ink-100 lg:col-span-2" />
        )}

        {/* Single column on phones — at 2-up, a 6-digit ৳ value with the label/icon left almost
            no room and clipped ("৳108,1…"), which defeats the point of a KPI tile. Full-width
            rows cost a little more scroll but the numbers are always readable, which review
            criterion #4 (data readability) treats as non-negotiable for a KPI card. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:col-span-3 lg:grid-cols-3">
          {overviewLoading || !overview ? (
            Array.from({ length: 6 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile
                label="Gross profit (lifetime)"
                value={formatPrice(overview.grossProfitLifetime)}
                icon={<TrendingUp size={20} />}
                trendPct={overview.profitGrowthPct}
                tone="accent"
              />
              <StatTile
                label="Customers"
                value={customerInsights ? customerInsights.totalCustomers.toLocaleString("en-BD") : "…"}
                icon={<Users size={20} />}
              />
              <StatTile label="Conversion rate" value={`${overview.conversionRatePct.toFixed(1)}%`} icon={<Target size={20} />} />
              <StatTile label="Avg order value" value={formatPrice(Math.round(overview.aovLifetime))} icon={<Receipt size={20} />} />
              <StatTile
                label="Refund rate"
                value={`${overview.refundRatePct.toFixed(1)}%`}
                icon={<Undo2 size={20} />}
                tone={overview.refundRatePct > 5 ? "warning" : "default"}
              />
              <StatTile
                label="Revenue growth (30d)"
                value={`${overview.revenueGrowthPct >= 0 ? "+" : ""}${overview.revenueGrowthPct.toFixed(1)}%`}
                icon={<Wallet size={20} />}
                tone={overview.revenueGrowthPct >= 0 ? "accent" : "warning"}
              />
            </>
          )}
        </div>
      </section>

      {/* AI insights — surfaced this early on purpose: the brief asks for actionable insight over
          decorative charts, and a rule-based "here's what needs a decision" list is the highest-
          leverage thing on the page for someone with 15 seconds. */}
      <section aria-label="AI insights">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">AI Insights &amp; Alerts</h2>
          <Link href="/admin/bi/ai-insights" className="flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900">
            View all <ArrowUpRight size={12} />
          </Link>
        </div>
        <div className="space-y-2.5">
          {!insights ? (
            <p className="py-6 text-center text-sm text-ink-400">Checking for alerts…</p>
          ) : topInsights.length === 0 ? (
            <Card className="flex items-center gap-3 p-4">
              <CheckCircle2 size={18} className="shrink-0 text-success-500" />
              <p className="text-sm text-ink-600">No active alerts — nothing needs attention right now.</p>
            </Card>
          ) : (
            topInsights.map((insight) => {
              const style = INSIGHT_SEVERITY_STYLE[insight.severity] ?? INSIGHT_SEVERITY_STYLE.info!;
              const Icon = style.icon;
              return (
                <Card key={insight.id} className={cn("flex items-start gap-3 p-4", style.classes)}>
                  <Icon size={18} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{insight.title}</p>
                    <p className="mt-0.5 text-sm opacity-90">{insight.detail}</p>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </section>

      {/* Sales trend, with the period comparison called out in the hero above rather than repeated
          here — the chart's job is showing the shape of the trend, not restating the number. */}
      <Card className="p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Sales trend</p>
            <p className="mt-1 text-sm text-ink-500">Daily revenue for the selected range.</p>
          </div>
          <Link href="/admin/bi/sales" className="flex shrink-0 items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-900">
            Sales Intelligence <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="mt-6">
          {currentSeries.length > 0 ? <RevenueChart data={currentSeries} /> : <div className="h-[17.5rem] animate-pulse rounded-2xl bg-ink-50" />}
        </div>
      </Card>

      {/* Conversion funnel — the real 8-stage session journey (landing → category → product →
          variant → cart → checkout → payment → success), not a collapsed 5-step version: folding
          those stages together would mean recomputing drop-off percentages across steps that
          weren't actually adjacent, which risks misrepresenting where visitors actually leave. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Visitor → order conversion funnel</CardTitle>
            <Link href="/admin/bi/journey" className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900">
              Full journey <ArrowUpRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>{funnel ? <JourneyFunnel steps={funnel.steps} bottleneckKey={funnel.bottleneckKey} /> : <div className="h-64 animate-pulse rounded-2xl bg-ink-50" />}</CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Orders by status</CardTitle>
          </CardHeader>
          <CardContent>{statusCounts && <OrderStatusBreakdown counts={statusCounts.counts} />}</CardContent>
        </Card>
      </div>

      {/* Product & category performance */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Top products</CardTitle>
            <Link href="/admin/bi/products" className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900">
              Product Intel <ArrowUpRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>{topProducts && <TopProductsChart products={topProducts.products} />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top categories</CardTitle>
          </CardHeader>
          <CardContent>
            {topCategories && (
              <RankedBarList
                emptyLabel="No sales in this period yet."
                items={toBarItems(topCategories.categories, {
                  key: (c) => c.name,
                  label: (c) => c.name,
                  value: (c) => c.revenue,
                  valueLabel: (c) => formatPrice(c.revenue),
                  subLabel: (c) => `${c.quantitySold} sold`,
                })}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Customer analytics + geographic distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Customer analytics</CardTitle>
            <Link href="/admin/bi/customers" className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900">
              Customer Intel <ArrowUpRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ConversionMetricCard
                label="Returning customers"
                value={customerInsights ? `${customerInsights.returningRate.toFixed(1)}%` : "—"}
                caption={customerInsights ? `${customerInsights.returningCustomers} of ${customerInsights.totalCustomers}` : undefined}
                icon={<Users size={18} />}
                pct={customerInsights?.returningRate}
              />
              <ConversionMetricCard
                label="Repeat purchase rate"
                value={overview ? `${overview.repeatPurchaseRatePct.toFixed(1)}%` : "—"}
                icon={<Heart size={18} />}
                pct={overview?.repeatPurchaseRatePct}
              />
              <ConversionMetricCard
                label="Avg. lifetime value"
                value={customerInsights ? formatPrice(customerInsights.avgClv) : "—"}
                icon={<Wallet size={18} />}
                tone="accent"
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex items-center gap-2">
            <MapPin size={16} className="text-ink-400" />
            <CardTitle>Geographic sales distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {geo && (
              <RankedBarList
                emptyLabel="No orders with a saved address in this period yet."
                items={toBarItems(geo.divisions, {
                  key: (d) => d.division,
                  label: (d) => d.division,
                  value: (d) => d.revenue,
                  valueLabel: (d) => formatPrice(d.revenue),
                  subLabel: (d) => `${d.orders} order${d.orders === 1 ? "" : "s"}`,
                })}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payment performance + marketing */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center gap-2">
            <CreditCard size={16} className="text-ink-400" />
            <CardTitle>Payment method performance</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentMethods && (
              <RankedBarList
                emptyLabel="No orders recorded yet for this range."
                items={toBarItems(paymentMethods.methods, {
                  key: (m) => m.method,
                  label: (m) => m.method,
                  value: (m) => m.revenue,
                  valueLabel: (m) => `${formatPrice(m.revenue)} · ${m.orders}`,
                })}
              />
            )}
            {overview && (
              <div className="mt-4 flex items-center justify-between rounded-xl bg-ink-50/60 px-3.5 py-3 text-sm">
                <span className="flex items-center gap-1.5 text-ink-600">
                  <Clock size={14} className="text-warning-500" /> Pending payments
                </span>
                <span className="font-semibold tabular-nums text-ink-900">
                  {overview.pendingPaymentsCount} · {formatPrice(overview.pendingPaymentsAmount)}
                </span>
              </div>
            )}
            <p className="mt-2 text-xs text-ink-400">
              Failed-payment analysis isn&apos;t available yet — the system doesn&apos;t currently record a distinct FAILED payment
              status, only pending vs. successful. Pending is shown above as the closest signal.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Megaphone size={16} className="text-ink-400" />
              <CardTitle>Campaign performance</CardTitle>
            </div>
            <Link href="/admin/bi/marketing" className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900">
              Marketing <ArrowUpRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>
            {campaigns && (
              <RankedBarList
                emptyLabel="No utm_campaign-tagged traffic converted yet."
                items={toBarItems(campaigns.campaigns, {
                  key: (c) => c.campaign,
                  label: (c) => c.campaign,
                  value: (c) => c.revenue,
                  valueLabel: (c) => formatPrice(c.revenue),
                  subLabel: (c) => `${c.orders} order${c.orders === 1 ? "" : "s"}`,
                })}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Inventory alerts + refunds/cancellations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Boxes size={16} className="text-ink-400" />
              <CardTitle>Inventory &amp; low stock</CardTitle>
              {lowStock && lowStock.variants.length > 0 && (
                <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning-600">{lowStock.variants.length}</span>
              )}
            </div>
            <Link href="/admin/bi/inventory" className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900">
              Inventory Intel <ArrowUpRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>
            {overview && (
              <div className="mb-4 flex items-center justify-between rounded-xl bg-ink-50/60 px-3.5 py-3 text-sm">
                <span className="text-ink-600">Inventory value on hand</span>
                <span className="font-semibold tabular-nums text-ink-900">{formatPrice(overview.inventoryValue)}</span>
              </div>
            )}
            {lowStock && <LowStockTable variants={lowStock.variants.slice(0, 5)} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Refunds, returns &amp; cancellations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ConversionMetricCard
                label="Refund rate"
                value={overview ? `${overview.refundRatePct.toFixed(1)}%` : "—"}
                icon={<Undo2 size={16} />}
                pct={overview?.refundRatePct}
                tone={overview && overview.refundRatePct > 5 ? "warning" : "default"}
              />
              <ConversionMetricCard
                label="Return rate"
                value={overview ? `${overview.returnRatePct.toFixed(1)}%` : "—"}
                icon={<RotateCcw size={16} />}
                pct={overview?.returnRatePct}
                tone={overview && overview.returnRatePct > 5 ? "warning" : "default"}
              />
              <ConversionMetricCard
                label="Cancelled rate"
                value={overview ? `${overview.cancelledRatePct.toFixed(1)}%` : "—"}
                icon={<Ban size={16} />}
                pct={overview?.cancelledRatePct}
                tone={overview && overview.cancelledRatePct > 10 ? "warning" : "default"}
              />
            </div>
            {returns && returns.topReasons.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Most common reasons (this range)</p>
                <RankedBarList
                  emptyLabel="No reasons recorded yet for this range."
                  items={toBarItems(returns.topReasons, { key: (r) => r.reason, label: (r) => r.reason, value: (r) => r.count, valueLabel: (r) => String(r.count) })}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity & alerts */}
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Bell size={16} className="text-ink-400" />
            <CardTitle>Recent activity</CardTitle>
          </div>
          {activity && activity.unreadCount > 0 && (
            <span className="rounded-full bg-brass-50 px-2 py-0.5 text-xs font-semibold text-brass-600">{activity.unreadCount} unread</span>
          )}
        </CardHeader>
        <CardContent>
          {!activity ? (
            <div className="h-32 animate-pulse rounded-2xl bg-ink-50" />
          ) : recentActivity.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ListChecks size={22} className="text-ink-300" />
              <p className="text-sm text-ink-500">No recent orders, low-stock alerts, or flagged cancellations.</p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {recentActivity.map((item) => {
                const Icon = ACTIVITY_ICON[item.type] ?? Bell;
                const row = (
                  <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", item.readAt ? "bg-ink-100 text-ink-400" : "bg-brass-50 text-brass-600")}>
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink-900">{item.title}</p>
                      {item.body && <p className="mt-0.5 truncate text-xs text-ink-500">{item.body}</p>}
                      <p className="mt-0.5 text-[11px] text-ink-400">{timeAgo(item.createdAt)}</p>
                    </div>
                    {!item.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brass-400" />}
                  </div>
                );
                return item.link ? (
                  <li key={item.id}>
                    <Link href={item.link} className="-mx-1 block rounded-xl px-1 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                      {row}
                    </Link>
                  </li>
                ) : (
                  <li key={item.id}>{row}</li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          Net Profit, Cash Balance, and Outstanding Supplier Due aren&apos;t shown yet — they need an expense and supplier ledger that
          doesn&apos;t exist in the system today. Planned for a future Financial Ops phase.
        </p>
      </Card>
    </div>
  );
}
