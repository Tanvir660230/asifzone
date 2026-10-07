"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard, MetricCardSkeleton, MetricStrip } from "@/components/admin/metric-card";
import { RevenueChartCard, type RevenueRangeDays } from "@/components/admin/revenue-chart-card";
import { LowStockTable } from "@/components/admin/low-stock-table";
import { DemandForecastTable } from "@/components/admin/demand-forecast-table";
import { ActionCenter } from "@/components/admin/dashboard/action-center";
import { RecentOrdersCard } from "@/components/admin/dashboard/recent-orders-card";
import { CourierHealthCard, PaymentsHealthCard } from "@/components/admin/dashboard/health-cards";
import { InsightsStrip } from "@/components/admin/dashboard/insights-strip";
import { AbandonedCartsDrawer } from "@/components/admin/dashboard/abandoned-carts-drawer";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { useAttentionCounts } from "@/hooks/use-attention-counts";
import { useCapabilities } from "@/hooks/use-capability";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { computeTrendPct, formatPrice, formatStoreDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** An Apple-style section title: sentence case, semibold, with an optional quiet link on the right. */
function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-[17px] font-semibold tracking-tight text-fg">{title}</h2>
      {action}
    </div>
  );
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-0.5 text-[13px] font-medium text-accent hover:underline">
      {children} <ArrowUpRight size={13} aria-hidden />
    </Link>
  );
}

const LOW_STOCK_SHOWN = 6;

/**
 * The admin home: an operations cockpit, not an analytics report (Blueprint V2 §K-Home). Top to bottom it answers "what's
 * waiting on me" (Action Center), "how is today going" (today's figures), "what just happened" (revenue + recent orders),
 * "is money and delivery healthy" (payments, courier), "what's about to run out" (stock), then a 30-day pulse. Deep
 * analysis lives in Analytics and is linked, not duplicated.
 */
export default function DashboardPage() {
  const { data: currentAdmin } = useCurrentAdmin();
  const admin = currentAdmin?.admin;
  const { can } = useCapabilities();
  const canAnalytics = can("analytics.view");
  const canOrders = can("orders.view");
  const canInventory = can("inventory.view");
  const canPayments = can("payments.view");

  // Computed after mount (not during render) so server markup and the first client paint match — `new Date()` depends
  // on the reader's clock/timezone and would otherwise risk a hydration mismatch.
  const [greeting, setGreeting] = useState("Welcome back");
  const [dateLabel, setDateLabel] = useState("");
  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    setGreeting(hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");
    setDateLabel(formatStoreDate(now, { weekday: "long", month: "long", day: "numeric" }));
  }, []);

  const attention = useAttentionCounts();
  const canCustomers = can("customers.view");
  const [cartsOpen, setCartsOpen] = useState(false);
  const { orderStats, payments } = attention;

  const { data: summary } = useQuery({ queryKey: ["analytics-summary"], queryFn: analyticsApi.getSummary, enabled: canAnalytics });
  // One key per range, so the sparkline's 30 days and the chart's default 30D are a single request.
  const { data: revenue } = useQuery({
    queryKey: ["analytics-revenue", 30],
    queryFn: () => analyticsApi.getRevenueSeries(30),
    enabled: canAnalytics,
  });
  // Below the fold (Blueprint V2 §performance): charts and tables start once the attention row has answered, so the
  // first requests on Home are the ones the owner reads first.
  const belowFold = canAnalytics && !attention.loading;
  // Independent of the 30-day `revenue` above (the today card's sparkline) — drives only the chart's 7D/30D/90D filter.
  const [chartRange, setChartRange] = useState<RevenueRangeDays>(30);
  const { data: chartRevenue, isFetching: chartRevenueFetching } = useQuery({
    queryKey: ["analytics-revenue", chartRange],
    queryFn: () => analyticsApi.getRevenueSeries(chartRange),
    enabled: belowFold,
  });
  // Polled every 30s so "on the site right now" stays current — the endpoint itself is cached only 15s server-side.
  const { data: activeVisitors } = useQuery({
    queryKey: ["analytics-active-visitors"],
    queryFn: analyticsApi.getActiveVisitors,
    enabled: canAnalytics,
    refetchInterval: 30_000,
  });
  const { data: profit } = useQuery({
    queryKey: ["analytics-profit-trend", 30],
    queryFn: () => analyticsApi.getProfitTrend(30),
    enabled: belowFold,
  });
  const { data: funnel } = useQuery({
    queryKey: ["analytics-funnel"],
    queryFn: () => analyticsApi.getConversionFunnel(30),
    enabled: belowFold,
  });
  const { data: cartAbandonment } = useQuery({
    queryKey: ["analytics-cart-abandonment"],
    queryFn: analyticsApi.getCartAbandonment,
    enabled: belowFold,
  });
  const { data: lowStock } = useQuery({ queryKey: ["analytics-low-stock"], queryFn: analyticsApi.getLowStock, enabled: belowFold });
  const { data: demandForecast } = useQuery({
    queryKey: ["analytics-demand-forecast"],
    queryFn: () => analyticsApi.getDemandForecast(14, 6),
    enabled: belowFold,
  });

  const profitTotals = useMemo(() => {
    if (!profit) return null;
    const t = profit.series.reduce((acc, p) => ({ revenue: acc.revenue + p.revenue, profit: acc.profit + p.profit }), { revenue: 0, profit: 0 });
    return { ...t, marginPct: t.revenue > 0 ? (t.profit / t.revenue) * 100 : null };
  }, [profit]);

  return (
    <div className="space-y-10">
      {/* Greeting — a plain large title on the canvas, the page's one primary action beside it */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-fg-muted">{dateLabel || " "}</p>
          <h1 className="mt-1 text-[32px] font-semibold leading-tight tracking-tight text-fg sm:text-[34px]">
            {greeting}
            {admin ? `, ${firstName(admin.name)}` : ""}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {activeVisitors && (
            <Link
              href={canAnalytics ? "/admin/bi/visitors" : "#"}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-surface px-3.5 text-[13px] font-medium text-fg-muted shadow ring-1 ring-line transition-colors hover:text-fg"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                {activeVisitors.count > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-500 opacity-60" />}
                <span className={cn("relative inline-flex h-2 w-2 rounded-full", activeVisitors.count > 0 ? "bg-success-500" : "bg-ink-300")} />
              </span>
              {activeVisitors.count} on the store now
            </Link>
          )}
          {can("orders.manage") && (
            <Link href="/admin/orders/new">
              <Button variant="primary">
                <Plus size={16} /> Create order
              </Button>
            </Link>
          )}
        </div>
      </header>

      {/* 1 — What's waiting on me */}
      <ActionCenter
        orderStats={orderStats}
        payments={payments}
        pendingReviews={attention.pendingReviews}
        unreadFeedback={attention.unreadFeedback}
        lowStockCount={summary?.lowStockCount}
        loading={attention.loading}
      />

      {/* 2 — How today is going */}
      <section aria-label="Today">
        <SectionHeader title="Today" action={canOrders ? <SectionLink href="/admin/orders">All orders</SectionLink> : undefined} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {orderStats && (revenue || !canAnalytics) ? (
            <MetricCard
              label="Net sales today"
              value={formatPrice(orderStats.todayRevenue)}
              detail={`${orderStats.todayOrders} order${orderStats.todayOrders === 1 ? "" : "s"} today`}
              trendPct={summary ? computeTrendPct(summary.revenue30d, summary.revenuePrev30d) : undefined}
              trendLabel="30-day trend"
              sparkline={revenue?.series.slice(-14).map((p) => p.revenue)}
              href={canAnalytics ? "/admin/bi/sales" : undefined}
            />
          ) : (
            <MetricCardSkeleton />
          )}
          {orderStats ? (
            <>
              <MetricCard label="Orders today" value={String(orderStats.todayOrders)} detail="Placed since midnight" href="/admin/orders" />
              <MetricCard
                label="To confirm"
                value={String(orderStats.pending)}
                detail="Pending or confirmed, not yet moving"
                tone={orderStats.pending > 0 ? "attention" : "default"}
                href="/admin/orders?status=PENDING,CONFIRMED"
              />
              <MetricCard
                label="Follow-up calls due"
                value={String(orderStats.followUpDue)}
                detail="Callback time reached"
                tone={orderStats.followUpDue > 0 ? "attention" : "default"}
                href="/admin/orders?queue=followUpDue"
              />
            </>
          ) : (
            <>
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
            </>
          )}
        </div>
        <MetricStrip
          className="mt-4"
          items={[
            { label: "On the store now", value: activeVisitors ? String(activeVisitors.count) : "—", href: canAnalytics ? "/admin/bi/visitors" : undefined },
            {
              label: "Payment success today",
              value: payments ? (payments.attemptsToday > 0 ? `${Math.round(payments.successRateTodayPct)}%` : "No attempts") : "—",
              href: canPayments ? "/admin/payments/overview" : undefined,
            },
            {
              label: "Abandoned carts",
              value: cartAbandonment ? `${cartAbandonment.cartCount} · ${formatPrice(cartAbandonment.potentialRevenue)}` : "—",
              onClick: canCustomers ? () => setCartsOpen(true) : undefined,
              href: !canCustomers && canAnalytics ? "/admin/bi/products" : undefined,
            },
          ]}
        />
      </section>

      {/* 3 — What just happened */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <RevenueChartCard series={chartRevenue?.series} range={chartRange} onRangeChange={setChartRange} loading={chartRevenueFetching} />
        </div>
        <div className="min-w-0 xl:col-span-2">{canOrders && <RecentOrdersCard />}</div>
      </div>

      {/* 4 — Is money and delivery healthy */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {canPayments && <PaymentsHealthCard data={payments} />}
        {canAnalytics && <CourierHealthCard courierLoss30d={summary?.courierLoss30d} />}
      </div>

      <InsightsStrip enabled={canAnalytics} />

      {/* 5 — What's about to run out */}
      {canAnalytics && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <CardTitle>Low stock</CardTitle>
                {lowStock && lowStock.variants.length > 0 && (
                  <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning-700">{lowStock.variants.length}</span>
                )}
              </div>
              {canInventory && <SectionLink href="/admin/inventory">Inventory</SectionLink>}
            </CardHeader>
            <CardContent>
              {lowStock ? (
                <>
                  <LowStockTable variants={lowStock.variants.slice(0, LOW_STOCK_SHOWN)} />
                  {lowStock.variants.length > LOW_STOCK_SHOWN && (
                    <Link
                      href={canInventory ? "/admin/inventory" : "/admin/bi/inventory"}
                      className="mt-3 flex items-center justify-center gap-1 rounded-lg py-2 text-[13px] font-medium text-accent hover:bg-accent/[0.06]"
                    >
                      Show {lowStock.variants.length - LOW_STOCK_SHOWN} more
                    </Link>
                  )}
                </>
              ) : (
                <div className="h-40 rounded-xl ui-skeleton" />
              )}
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>Likely to sell out in 14 days</CardTitle>
              <SectionLink href="/admin/bi/inventory">Forecast</SectionLink>
            </CardHeader>
            <CardContent>
              {demandForecast ? <DemandForecastTable variants={demandForecast.variants} /> : <div className="h-40 rounded-xl ui-skeleton" />}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 6 — 30-day pulse */}
      {canAnalytics && (
        <section aria-label="Last 30 days">
          <SectionHeader title="Last 30 days" action={<SectionLink href="/admin/bi/overview">Open Analytics</SectionLink>} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            <MetricCard
              label="Net sales"
              value={summary ? formatPrice(summary.revenue30d) : "—"}
              trendPct={summary ? computeTrendPct(summary.revenue30d, summary.revenuePrev30d) : undefined}
              trendLabel="vs previous 30 days"
              href="/admin/bi/sales"
            />
            <MetricCard
              label="Gross profit"
              // No recorded costs at all means profit is unknown, not zero.
              value={
                profitTotals && profit && profit.costCoverage.recorded > 0 ? formatPrice(Math.round(profitTotals.profit)) : profit ? "No cost data" : "—"
              }
              detail={profitTotals && profit && profit.costCoverage.recorded > 0 && profitTotals.marginPct !== null ? `${profitTotals.marginPct.toFixed(0)}% margin` : undefined}
              href="/admin/bi/financial"
            />
            <MetricCard
              label="Orders"
              value={summary ? String(summary.orders30d) : "—"}
              trendPct={summary ? computeTrendPct(summary.orders30d, summary.ordersPrev30d) : undefined}
              trendLabel="vs previous 30 days"
              href="/admin/bi/sales"
            />
            <MetricCard
              label="Average order value"
              value={summary ? formatPrice(Math.round(summary.aov30d)) : "—"}
              trendPct={summary ? computeTrendPct(summary.aov30d, summary.aovPrev30d) : undefined}
              trendLabel="vs previous 30 days"
              href="/admin/bi/sales"
            />
            <MetricCard
              label="Visitors"
              value={summary ? String(summary.uniqueVisitors30d) : "—"}
              detail={funnel ? `${funnel.conversionRate.toFixed(1)}% placed an order` : undefined}
              trendPct={summary ? computeTrendPct(summary.uniqueVisitors30d, summary.uniqueVisitorsPrev30d) : undefined}
              href="/admin/bi/visitors"
            />
          </div>
          {profit && profit.costCoverage.missing > 0 && (
            <p className="mt-3 text-xs text-fg-muted">
              Gross profit counts only order lines with a recorded cost — {profit.costCoverage.missing} line
              {profit.costCoverage.missing === 1 ? "" : "s"} in this window have none.
            </p>
          )}
        </section>
      )}

      {canCustomers && <AbandonedCartsDrawer open={cartsOpen} onClose={() => setCartsOpen(false)} />}
    </div>
  );
}
