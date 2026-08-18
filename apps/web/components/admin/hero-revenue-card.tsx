import { ShoppingBag, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/admin/sparkline";
import { cn } from "@/lib/utils";

interface HeroRevenueCardProps {
  value: string;
  todayOrders: number;
  /** Percent change vs. the prior 30-day window — the only baseline the API exposes, so it's
   * labeled explicitly rather than implied to be a day-over-day comparison. */
  trendPct?: number | null;
  series: number[];
  className?: string;
  /** Overrides for callers whose baseline isn't literally "today" (e.g. a BI dashboard driven by
   * a date-range picker) — all default to the original dashboard wording so existing callers are
   * unaffected. */
  label?: string;
  ordersSuffix?: string;
  trendLabel?: string;
}

export function HeroRevenueCard({
  value,
  todayOrders,
  trendPct,
  series,
  className,
  label = "Today's revenue",
  ordersSuffix = "today",
  trendLabel = "30-day trend",
}: HeroRevenueCardProps) {
  const hasTrend = trendPct !== null && trendPct !== undefined && Number.isFinite(trendPct);
  const isUp = hasTrend && trendPct! >= 0;

  return (
    <Card
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden border-ink-900 bg-ink-900 p-6 text-cream-50 transition-all duration-300 ease-smooth hover:-translate-y-1 hover:shadow-floatLg sm:p-7",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-success-500/10 blur-3xl transition-transform duration-300 ease-smooth group-hover:scale-110"
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
          <Wallet size={20} />
        </div>
        {hasTrend && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
              isUp ? "bg-success-500/15 text-success-400" : "bg-danger-500/15 text-danger-400",
            )}
          >
            {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(trendPct!).toFixed(0)}% {trendLabel}
          </span>
        )}
      </div>

      <div className="relative mt-6 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-cream-50/50">{label}</p>
        <p className="text-4xl font-semibold tabular-nums leading-tight tracking-tight sm:text-[2.75rem]">{value}</p>
        <p className="flex items-center gap-1.5 text-sm text-cream-50/60">
          <ShoppingBag size={14} /> {todayOrders} order{todayOrders === 1 ? "" : "s"} {ordersSuffix}
        </p>
      </div>

      <div className="relative mt-6">
        <div className="h-14 text-cream-50/70">
          <Sparkline data={series} className="h-full w-full" />
        </div>
        {series.length > 1 && <p className="mt-1.5 text-[11px] text-cream-50/40">Revenue — last {series.length} days</p>}
      </div>
    </Card>
  );
}
