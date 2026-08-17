import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ConversionMetricCardProps {
  label: string;
  value: string;
  caption?: string;
  icon: ReactNode;
  tone?: "default" | "warning" | "accent";
  /** 0-100 — renders a fill bar under the value, for rate-based metrics (conversion, bounce). */
  pct?: number;
  /** Renders a trend badge instead of a bar, for non-rate metrics (e.g. average order value). */
  trendPct?: number | null;
}

const TONE = {
  default: { chip: "bg-ink-50 text-ink-500", bar: "bg-ink-400" },
  warning: { chip: "bg-warning-50 text-warning-600", bar: "bg-warning-500" },
  accent: { chip: "bg-info-50 text-info-600", bar: "bg-info-500" },
};

export function ConversionMetricCard({ label, value, caption, icon, tone = "default", pct, trendPct }: ConversionMetricCardProps) {
  const t = TONE[tone];
  const hasTrend = trendPct !== null && trendPct !== undefined && Number.isFinite(trendPct);
  const isUp = hasTrend && trendPct! >= 0;

  return (
    <Card className="p-5 transition-all duration-300 ease-smooth hover:-translate-y-1 hover:shadow-floatLg sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", t.chip)}>{icon}</div>
          <p className="text-[11px] font-semibold uppercase leading-tight tracking-wider text-ink-400">{label}</p>
        </div>
        {hasTrend && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold",
              isUp ? "bg-success-50 text-success-600" : "bg-danger-50 text-danger-600",
            )}
          >
            {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(trendPct!).toFixed(0)}%
          </span>
        )}
      </div>

      <p className="mt-3.5 text-3xl font-semibold tabular-nums leading-tight tracking-tight text-ink-900">{value}</p>
      {caption && <p className="mt-1 text-xs text-ink-500">{caption}</p>}

      {pct !== undefined && (
        <div className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className={cn("h-full rounded-full transition-all duration-500 ease-smooth", t.bar)}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      )}
    </Card>
  );
}
