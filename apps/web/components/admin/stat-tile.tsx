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
    <Card className="group relative flex items-center gap-3 p-4 transition-all duration-300 ease-smooth hover:-translate-y-1 hover:shadow-floatLg sm:gap-3.5 sm:p-5">
      {/* A tile only ever gets tone="warning" when its underlying count is actually > 0 (callers
          gate it), so the pulse doubles as a real "needs a look" signal, not decoration. */}
      {tone === "warning" && (
        <span className="absolute right-4 top-4 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-warning-500" />
        </span>
      )}
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-transform duration-300 ease-smooth group-hover:scale-105 sm:h-11 sm:w-11",
          TONE_CHIP[tone],
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase leading-tight tracking-wider text-ink-400">{label}</p>
        {/* flex-wrap, not truncate, on this row — the value is the whole point of the tile, so if
            the trend badge doesn't fit next to it at a given width, the badge wraps to its own line
            instead of the number being cut off with an ellipsis. The value itself still gets
            `truncate` as a hard floor for pathological cases (e.g. a Steadfast balance running into
            7+ figures) — it has no spaces to wrap on and would otherwise spill past the card edge. */}
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="max-w-full truncate font-sans text-xl font-semibold tabular-nums leading-tight tracking-tight text-ink-900 sm:text-2xl">
            {value}
          </p>
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
      </div>
    </Card>
  );
}

/** Matches StatTile's exact shape so the KPI grid doesn't reflow/pop when the query resolves. */
export function StatTileSkeleton() {
  return (
    <Card className="flex items-center gap-3 p-4 sm:gap-3.5 sm:p-5">
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-2xl bg-ink-100 sm:h-11 sm:w-11" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-16 animate-pulse rounded bg-ink-100" />
        <div className="h-7 w-20 animate-pulse rounded bg-ink-100" />
      </div>
    </Card>
  );
}
