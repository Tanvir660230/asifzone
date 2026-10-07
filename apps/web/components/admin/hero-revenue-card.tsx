import { ShoppingBag, TrendingDown, TrendingUp } from "lucide-react";
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
  label = "Today's realised net sales",
  ordersSuffix = "today",
  trendLabel = "30-day trend",
}: HeroRevenueCardProps) {
  const hasTrend = trendPct !== null && trendPct !== undefined && Number.isFinite(trendPct);
  const isUp = hasTrend && trendPct! >= 0;

  return (
    <Card className={cn("flex flex-col justify-between p-6 sm:p-7", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-fg-muted">{label}</p>
        {hasTrend && (
          <span className={cn("flex shrink-0 items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold", isUp ? "text-success-700" : "text-danger-600")}>
            {isUp ? <TrendingUp size={13} aria-hidden /> : <TrendingDown size={13} aria-hidden />}
            {Math.abs(trendPct!).toFixed(0)}% <span className="font-medium text-fg-muted">{trendLabel}</span>
          </span>
        )}
      </div>

      <div className="mt-3 space-y-1">
        <p className="text-[40px] font-semibold tabular-nums leading-tight tracking-tight text-fg">{value}</p>
        <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">
          <ShoppingBag size={14} aria-hidden /> {todayOrders} order{todayOrders === 1 ? "" : "s"} {ordersSuffix}
        </p>
      </div>

      <div className="mt-5">
        <div className="h-14 text-accent">
          <Sparkline data={series} className="h-full w-full" />
        </div>
        {series.length > 1 && <p className="mt-1.5 text-xs text-fg-subtle">Realised net sales — last {series.length} days</p>}
      </div>
    </Card>
  );
}
