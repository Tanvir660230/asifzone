"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BarChart3,
  Boxes,
  CalendarDays,
  Clock,
  CreditCard,
  DollarSign,
  Gauge,
  Megaphone,
  PhoneCall,
  PiggyBank,
  Plus,
  Radio,
  Receipt,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Timer,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { HeroRevenueCard } from "@/components/admin/hero-revenue-card";
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
import { adminCan } from "@/lib/auth";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { computeTrendPct, formatPrice, formatStoreDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{children}</p>
      {action}
    </div>
  );
}

const LOW_STOCK_SHOWN = 6;

/** Where the deep analytics that used to sit in this page's tabs now live — one entry per BI area. */
const BI_LINKS = [
  { href: "/admin/bi/sales", label: "Sales & conversion", icon: DollarSign },
  { href: "/admin/bi/products", label: "Product performance", icon: Shirt },
  { href: "/admin/bi/customers", label: "Cohorts & retention", icon: Users },
  { href: "/admin/bi/marketing", label: "Marketing & campaigns", icon: Megaphone },
  { href: "/admin/bi/visitors", label: "Visitors & traffic", icon: BarChart3 },
  { href: "/admin/bi/inventory", label: "Inventory health", icon: Boxes },
];

/**
 * The admin home: an operations cockpit, not an analytics report. Top to bottom it answers "what's waiting on me"
 * (Action Center), "how is today going" (today's tiles), "what just happened" (revenue + recent orders), "is money and
 * delivery healthy" (payments, courier), "what's about to run out" (stock), then a 30-day pulse. Deep analysis lives in
 * Business Intelligence and is linked, not duplicated.
 */
export default function DashboardPage() {
  const { data: currentAdmin } = useCurrentAdmin();
  const admin = currentAdmin?.admin;
  const canAnalytics = adminCan(admin, "analytics.read");
  const canOrders = adminCan(admin, "orders.read");
  const canInventory = adminCan(admin, "inventory.read");

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
  const canCustomers = adminCan(admin, "customers.read");
  const [cartsOpen, setCartsOpen] = useState(false);
  const { orderStats, payments } = attention;

  const { data: summary } = useQuery({ queryKey: ["analytics-summary"], queryFn: analyticsApi.getSummary, enabled: canAnalytics });
  const { data: revenue } = useQuery({
    queryKey: ["analytics-revenue"],
    queryFn: () => analyticsApi.getRevenueSeries(30),
    enabled: canAnalytics,
  });
  // Independent of the 30-day `revenue` above (the hero card's sparkline) — drives only the chart's 7D/30D/90D filter.
  const [chartRange, setChartRange] = useState<RevenueRangeDays>(30);
  const { data: chartRevenue, isFetching: chartRevenueFetching } = useQuery({
    queryKey: ["analytics-revenue-chart", chartRange],
    queryFn: () => analyticsApi.getRevenueSeries(chartRange),
    enabled: canAnalytics,
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
    enabled: canAnalytics,
  });
  const { data: funnel } = useQuery({
    queryKey: ["analytics-funnel"],
    queryFn: () => analyticsApi.getConversionFunnel(30),
    enabled: canAnalytics,
  });
  const { data: cartAbandonment } = useQuery({
    queryKey: ["analytics-cart-abandonment"],
    queryFn: analyticsApi.getCartAbandonment,
    enabled: canAnalytics,
  });
  const { data: lowStock } = useQuery({ queryKey: ["analytics-low-stock"], queryFn: analyticsApi.getLowStock, enabled: canAnalytics });
  const { data: demandForecast } = useQuery({
    queryKey: ["analytics-demand-forecast"],
    queryFn: () => analyticsApi.getDemandForecast(14, 6),
    enabled: canAnalytics,
  });

  const profitTotals = useMemo(() => {
    if (!profit) return null;
    const t = profit.series.reduce((acc, p) => ({ revenue: acc.revenue + p.revenue, profit: acc.profit + p.profit }), { revenue: 0, profit: 0 });
    return { ...t, marginPct: t.revenue > 0 ? (t.profit / t.revenue) * 100 : null };
  }, [profit]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-8">
      {/* Greeting */}
      <div className="relative overflow-hidden rounded-3xl border border-ink-100 bg-cream-50 px-6 py-7 shadow-sm sm:px-10 sm:py-9">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-ink-900/[0.03] blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl space-y-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
              <CalendarDays size={13} strokeWidth={2.5} />
              {dateLabel || " "}
            </p>
            <h1 className="font-display text-4xl leading-[1.1] tracking-tight text-ink-900 sm:text-[2.75rem]">
              {greeting}
              {admin ? `, ${firstName(admin.name)}` : ""}
            </h1>
            <p className="text-[15px] text-ink-500">Here&apos;s what needs you today, and how the store is doing.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {activeVisitors && (
              <div className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-cream-50 px-3.5 py-2 text-xs font-medium text-ink-600 shadow-sm">
                <span className="relative flex h-2 w-2 shrink-0">
                  {activeVisitors.count > 0 && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-500 opacity-75" />
                  )}
                  <span className={cn("relative inline-flex h-2 w-2 rounded-full", activeVisitors.count > 0 ? "bg-success-500" : "bg-ink-300")} />
                </span>
                {activeVisitors.count} live on site
              </div>
            )}
            {canAnalytics && (
              <Link href="/admin/bi/overview">
                <Button variant="outline">
                  <Gauge size={15} /> Business Intelligence
                </Button>
              </Link>
            )}
            {adminCan(admin, "orders.manage") && (
              <Link href="/admin/orders/new">
                <Button variant="primary">
                  <Plus size={16} /> Create order
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

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
      <section className="space-y-3.5" aria-label="Today">
        <SectionLabel>Today</SectionLabel>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {orderStats && (revenue || !canAnalytics) ? (
            <HeroRevenueCard
              className="lg:col-span-2"
              value={formatPrice(orderStats.todayRevenue)}
              todayOrders={orderStats.todayOrders}
              trendPct={summary ? computeTrendPct(summary.revenue30d, summary.revenuePrev30d) : undefined}
              series={revenue?.series.slice(-14).map((p) => p.revenue) ?? []}
            />
          ) : (
            <div className="h-[15.5rem] animate-pulse rounded-3xl bg-ink-100 lg:col-span-2" />
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-3">
            {orderStats ? (
              <>
                <StatTile label="Today's orders" value={String(orderStats.todayOrders)} icon={<ShoppingBag size={22} />} href="/admin/orders" />
                <StatTile
                  label="To confirm"
                  value={String(orderStats.pending)}
                  icon={<Clock size={22} />}
                  href="/admin/orders?status=PENDING,CONFIRMED"
                />
                <StatTile
                  label="Follow-up due"
                  value={String(orderStats.followUpDue)}
                  icon={<PhoneCall size={22} />}
                  tone={orderStats.followUpDue > 0 ? "warning" : "default"}
                  href="/admin/orders?queue=followUpDue"
                />
              </>
            ) : (
              <>
                <StatTileSkeleton />
                <StatTileSkeleton />
                <StatTileSkeleton />
              </>
            )}
            <StatTile
              label="On site right now"
              value={activeVisitors ? String(activeVisitors.count) : "—"}
              icon={<Radio size={22} />}
              tone={activeVisitors && activeVisitors.count > 0 ? "accent" : "default"}
              href={canAnalytics ? "/admin/bi/visitors" : undefined}
            />
            <StatTile
              label="Payment success"
              value={payments ? (payments.attemptsToday > 0 ? `${Math.round(payments.successRateTodayPct)}%` : "—") : "—"}
              icon={<CreditCard size={22} />}
              tone={payments && payments.attemptsToday > 0 && payments.successRateTodayPct < 60 ? "warning" : "default"}
              href={adminCan(admin, "payments.read") ? "/admin/payments/overview" : undefined}
            />
            <StatTile
              label="Abandoned carts"
              value={cartAbandonment ? `${cartAbandonment.cartCount} · ${formatPrice(cartAbandonment.potentialRevenue)}` : "—"}
              icon={<ShoppingCart size={22} />}
              onClick={canCustomers ? () => setCartsOpen(true) : undefined}
              href={!canCustomers && canAnalytics ? "/admin/bi/products" : undefined}
            />
          </div>
        </div>
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
        {adminCan(admin, "payments.read") && <PaymentsHealthCard data={payments} />}
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
                  <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning-600">{lowStock.variants.length}</span>
                )}
              </div>
              {canInventory && (
                <Link
                  href="/admin/inventory"
                  className="flex shrink-0 items-center gap-1 text-sm font-medium text-ink-500 transition-colors duration-150 ease-smooth hover:text-ink-900"
                >
                  Inventory <ArrowUpRight size={14} />
                </Link>
              )}
            </CardHeader>
            <CardContent>
              {lowStock ? (
                <>
                  <LowStockTable variants={lowStock.variants.slice(0, LOW_STOCK_SHOWN)} />
                  {lowStock.variants.length > LOW_STOCK_SHOWN && (
                    <Link
                      href={canInventory ? "/admin/inventory" : "/admin/bi/inventory"}
                      className="mt-3 flex items-center justify-center gap-1 rounded-xl border border-dashed border-line py-2.5 text-sm font-medium text-ink-500 transition-colors duration-150 ease-smooth hover:border-ink-300 hover:text-ink-900"
                    >
                      +{lowStock.variants.length - LOW_STOCK_SHOWN} more low-stock variants <ArrowUpRight size={14} />
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
              <CardTitle className="flex items-center gap-2">
                <Timer size={16} className="text-danger-500" /> Stockout risk · next 14 days
              </CardTitle>
              <Link
                href="/admin/bi/inventory"
                className="flex shrink-0 items-center gap-1 text-sm font-medium text-ink-500 transition-colors duration-150 ease-smooth hover:text-ink-900"
              >
                Forecast <ArrowUpRight size={14} />
              </Link>
            </CardHeader>
            <CardContent>
              {demandForecast ? <DemandForecastTable variants={demandForecast.variants} /> : <div className="h-40 rounded-xl ui-skeleton" />}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 6 — 30-day pulse */}
      {canAnalytics && (
        <section className="space-y-3.5" aria-label="Last 30 days">
          <SectionLabel
            action={
              <Link href="/admin/bi/overview" className="flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900">
                Full report <ArrowUpRight size={13} />
              </Link>
            }
          >
            Last 30 days
          </SectionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            <StatTile
              label="Net sales"
              value={summary ? formatPrice(summary.revenue30d) : "—"}
              icon={<DollarSign size={22} />}
              trendPct={summary ? computeTrendPct(summary.revenue30d, summary.revenuePrev30d) : undefined}
              href="/admin/bi/sales"
            />
            <StatTile
              label="Gross profit"
              // No recorded costs at all means profit is unknown, not zero.
              value={
                profitTotals && profit && profit.costCoverage.recorded > 0
                  ? `${formatPrice(Math.round(profitTotals.profit))}${profitTotals.marginPct !== null ? ` · ${profitTotals.marginPct.toFixed(0)}%` : ""}`
                  : profit
                    ? "No cost data"
                    : "—"
              }
              icon={<PiggyBank size={22} />}
              tone="accent"
              href="/admin/bi/financial"
            />
            <StatTile
              label="Orders"
              value={summary ? String(summary.orders30d) : "—"}
              icon={<ShoppingBag size={22} />}
              trendPct={summary ? computeTrendPct(summary.orders30d, summary.ordersPrev30d) : undefined}
              href="/admin/bi/sales"
            />
            <StatTile
              label="Avg order value"
              value={summary ? formatPrice(Math.round(summary.aov30d)) : "—"}
              icon={<Receipt size={22} />}
              trendPct={summary ? computeTrendPct(summary.aov30d, summary.aovPrev30d) : undefined}
              href="/admin/bi/sales"
            />
            <StatTile
              label={funnel ? `Visitors · ${funnel.conversionRate.toFixed(1)}% convert` : "Visitors"}
              value={summary ? String(summary.uniqueVisitors30d) : "—"}
              icon={<Users size={22} />}
              trendPct={summary ? computeTrendPct(summary.uniqueVisitors30d, summary.uniqueVisitorsPrev30d) : undefined}
              href="/admin/bi/visitors"
            />
          </div>
          {profit && profit.costCoverage.missing > 0 && (
            <p className="text-xs text-ink-400">
              Gross profit counts only order lines with a recorded cost — {profit.costCoverage.missing} line
              {profit.costCoverage.missing === 1 ? "" : "s"} in this window have none.
            </p>
          )}
        </section>
      )}

      {canCustomers && <AbandonedCartsDrawer open={cartsOpen} onClose={() => setCartsOpen(false)} />}

      {/* 7 — Where the deep analytics went */}
      {canAnalytics && (
        <section aria-label="Explore analytics" className="rounded-3xl border border-ink-100 bg-surface-muted p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg tracking-tight text-ink-900">Explore deeper</h2>
            <p className="text-sm text-ink-500">Every chart and breakdown lives in Business Intelligence.</p>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {BI_LINKS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-center gap-3 rounded-xl border border-line-subtle bg-surface px-4 py-3 text-sm font-medium text-ink-800 transition-all duration-150 ease-smooth hover:-translate-y-px hover:border-line hover:shadow-float"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-500 group-hover:bg-ink-900 group-hover:text-cream-50">
                  <Icon size={15} />
                </span>
                {label}
                <ArrowUpRight size={14} className="ml-auto text-ink-300 group-hover:text-ink-600" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
