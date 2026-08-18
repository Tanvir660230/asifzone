"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Wallet,
  CalendarDays,
  CalendarRange,
  TrendingUp,
  ShoppingBag,
  Receipt,
  Users,
  Repeat,
  Heart,
  Target,
  RotateCcw,
  Undo2,
  Ban,
  Boxes,
  Clock,
  Info,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { ConversionMetricCard } from "@/components/admin/conversion-metric-card";
import { Sparkline } from "@/components/admin/sparkline";
import * as biApi from "@/lib/api/bi";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { formatPrice } from "@/lib/format";

function pctLabel(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export default function ExecutiveOverviewPage() {
  const { data: overview, isLoading } = useQuery({ queryKey: ["bi-overview"], queryFn: biApi.getExecutiveOverview });
  const { data: revenueSeries } = useQuery({ queryKey: ["bi-overview-sparkline"], queryFn: () => analyticsApi.getRevenueSeries(14) });

  const sparklineData = revenueSeries?.series.map((p) => p.revenue) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Executive Overview</h1>
        <p className="mt-1 text-sm text-ink-500">The business at a glance — updated roughly every minute.</p>
      </div>

      {/* Hero — today's revenue, the first number an owner checks. */}
      <Card className="relative flex flex-col justify-between overflow-hidden border-ink-900 bg-ink-900 p-6 text-cream-50 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-success-500/10 blur-3xl"
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
            <Wallet size={20} />
          </div>
          {overview && (
            <span
              className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
                overview.revenueYesterday === 0
                  ? "bg-white/10 text-cream-50/70"
                  : overview.revenueToday >= overview.revenueYesterday
                    ? "bg-success-500/15 text-success-400"
                    : "bg-danger-500/15 text-danger-400"
              }`}
            >
              {overview.revenueYesterday > 0
                ? `${pctLabel(((overview.revenueToday - overview.revenueYesterday) / overview.revenueYesterday) * 100)} vs yesterday`
                : "No revenue yesterday to compare"}
            </span>
          )}
        </div>
        <div className="relative mt-6 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-cream-50/50">Today&apos;s revenue</p>
          <p className="text-4xl font-semibold tabular-nums leading-tight tracking-tight sm:text-[2.75rem]">
            {isLoading || !overview ? "…" : formatPrice(overview.revenueToday)}
          </p>
        </div>
        <div className="relative mt-6">
          <div className="h-14 text-cream-50/70">
            <Sparkline data={sparklineData} className="h-full w-full" />
          </div>
          {sparklineData.length > 1 && <p className="mt-1.5 text-[11px] text-cream-50/40">Revenue — last {sparklineData.length} days</p>}
        </div>
      </Card>

      {/* Revenue & orders */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Revenue &amp; Orders</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {isLoading || !overview ? (
            Array.from({ length: 8 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Yesterday" value={formatPrice(overview.revenueYesterday)} icon={<CalendarDays size={18} />} />
              <StatTile label="This Week" value={formatPrice(overview.revenueThisWeek)} icon={<CalendarRange size={18} />} />
              <StatTile
                label="This Month"
                value={formatPrice(overview.revenueThisMonth)}
                icon={<CalendarRange size={18} />}
                trendPct={overview.revenueGrowthPct}
                tone="accent"
              />
              <StatTile label="Lifetime Revenue" value={formatPrice(overview.revenueLifetime)} icon={<Wallet size={18} />} tone="accent" />
              <StatTile label="Lifetime Orders" value={overview.ordersLifetime.toLocaleString("en-BD")} icon={<ShoppingBag size={18} />} />
              <StatTile label="Average Order Value" value={formatPrice(overview.aovLifetime)} icon={<Receipt size={18} />} />
              <StatTile
                label="Gross Profit (est.)"
                value={formatPrice(overview.grossProfitLifetime)}
                icon={<TrendingUp size={18} />}
                trendPct={overview.profitGrowthPct}
                tone="accent"
              />
              <StatTile label="Inventory Value" value={formatPrice(overview.inventoryValue)} icon={<Boxes size={18} />} />
              <StatTile
                label="Pending Payments"
                value={`${formatPrice(overview.pendingPaymentsAmount)} · ${overview.pendingPaymentsCount}`}
                icon={<Clock size={18} />}
                tone={overview.pendingPaymentsCount > 0 ? "warning" : "default"}
              />
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-400">
          Gross profit is estimated against current cost prices — sale-time cost wasn&apos;t recorded historically, so this trends accurately
          but isn&apos;t an exact historical margin.
        </p>
      </section>

      {/* Visitors & conversion */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Visitors &amp; Conversion</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {isLoading || !overview ? (
            Array.from({ length: 4 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Total Visitors" value={overview.totalVisitors.toLocaleString("en-BD")} icon={<Users size={18} />} />
              <ConversionMetricCard
                label="Returning Visitors"
                value={overview.returningVisitors.toLocaleString("en-BD")}
                caption={`${overview.returningVisitorRatePct.toFixed(1)}% of all visitors`}
                icon={<Repeat size={18} />}
                pct={overview.returningVisitorRatePct}
              />
              <ConversionMetricCard
                label="Conversion Rate"
                value={`${overview.conversionRatePct.toFixed(1)}%`}
                icon={<Target size={18} />}
                pct={overview.conversionRatePct}
                tone="accent"
              />
              <ConversionMetricCard
                label="Repeat Purchase Rate"
                value={`${overview.repeatPurchaseRatePct.toFixed(1)}%`}
                icon={<Heart size={18} />}
                pct={overview.repeatPurchaseRatePct}
              />
              <StatTile label="Customer Lifetime Value" value={formatPrice(overview.customerLifetimeValue)} icon={<Wallet size={18} />} />
            </>
          )}
        </div>
      </section>

      {/* Risk signals */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Refunds, Returns &amp; Cancellations</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {isLoading || !overview ? (
            Array.from({ length: 3 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <ConversionMetricCard
                label="Refund Rate"
                value={`${overview.refundRatePct.toFixed(1)}%`}
                icon={<Undo2 size={18} />}
                pct={overview.refundRatePct}
                tone={overview.refundRatePct > 5 ? "warning" : "default"}
              />
              <ConversionMetricCard
                label="Return Rate"
                value={`${overview.returnRatePct.toFixed(1)}%`}
                icon={<RotateCcw size={18} />}
                pct={overview.returnRatePct}
                tone={overview.returnRatePct > 5 ? "warning" : "default"}
              />
              <ConversionMetricCard
                label="Cancelled Rate"
                value={`${overview.cancelledRatePct.toFixed(1)}%`}
                icon={<Ban size={18} />}
                pct={overview.cancelledRatePct}
                tone={overview.cancelledRatePct > 10 ? "warning" : "default"}
              />
            </>
          )}
        </div>
      </section>

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
