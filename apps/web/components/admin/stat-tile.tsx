import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatTileProps {
  label: string;
  value: string;
  icon: ReactNode;
  /** "accent" is the one blue highlight — reserve it for money/courier figures, not every tile. */
  tone?: "default" | "warning" | "accent";
  /** Percent change vs. the prior period, e.g. from computeTrend() — omit when no baseline exists (e.g. pending orders). */
  trendPct?: number | null;
}

const TONE_CHIP: Record<NonNullable<StatTileProps["tone"]>, string> = {
  default: "bg-ink-50 text-ink-500",
  warning: "bg-warning-50 text-warning-600",
  accent: "bg-info-50 text-info-600",
};

export function StatTile({ label, value, icon, tone = "default", trendPct }: StatTileProps) {
  const hasTrend = trendPct !== null && trendPct !== undefined && Number.isFinite(trendPct);
  const isUp = hasTrend && trendPct! >= 0;

  return (
    <Card className="flex items-center gap-3.5 p-4 transition-all duration-200 ease-smooth hover:-translate-y-0.5 hover:shadow-float sm:p-5">
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", TONE_CHIP[tone])}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase leading-tight tracking-wide text-ink-400">{label}</p>
        {/* flex-wrap, not truncate, on this row — the value is the whole point of the tile, so if
            the trend badge doesn't fit next to it at a given width, the badge wraps to its own line
            instead of the number being cut off with an ellipsis. */}
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="font-sans text-2xl font-semibold tabular-nums leading-tight tracking-tight text-ink-900">
            {value}
          </p>
          {hasTrend && (
            <span
              className={cn(
                "flex shrink-0 items-center gap-0.5 text-xs font-medium",
                isUp ? "text-success-600" : "text-danger-600",
              )}
            >
              {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {Math.abs(trendPct!).toFixed(0)}%
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Matches StatTile's exact shape so the KPI grid doesn't reflow/pop when the query resolves. */
export function StatTileSkeleton() {
  return (
    <Card className="flex items-center gap-3.5 p-4 sm:p-5">
      <div className="h-11 w-11 shrink-0 animate-pulse rounded-xl bg-ink-100" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-16 animate-pulse rounded bg-ink-100" />
        <div className="h-7 w-20 animate-pulse rounded bg-ink-100" />
      </div>
    </Card>
  );
}
