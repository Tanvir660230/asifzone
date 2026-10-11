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
  /** Renders a trend instead of a bar, for non-rate metrics (e.g. average order value). */
  trendPct?: number | null;
}

/** The corner icon and the bar carry the tone; the rest of the card is the shared metric-card language (StatTile). */
const TONE = {
  default: { icon: "text-ink-400", bar: "bg-accent" },
  warning: { icon: "text-warning-600", bar: "bg-warning-500" },
  accent: { icon: "text-accent", bar: "bg-accent" },
};

export function ConversionMetricCard({ label, value, caption, icon, tone = "default", pct, trendPct }: ConversionMetricCardProps) {
  const t = TONE[tone];
  const hasTrend = trendPct !== null && trendPct !== undefined && Number.isFinite(trendPct);
  const isUp = hasTrend && trendPct! >= 0;

  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-fg-muted">{label}</p>
        <span className={cn("shrink-0 [&>svg]:h-4 [&>svg]:w-4", t.icon)} aria-hidden>
          {icon}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 pt-2">
        <p className="text-[26px] font-semibold leading-tight tracking-tight tabular-nums text-fg">{value}</p>
        {hasTrend && (
          <span className={cn("flex shrink-0 items-center gap-0.5 text-[12.5px] font-semibold", isUp ? "text-success-700" : "text-danger-600")}>
            {isUp ? <TrendingUp size={13} aria-hidden /> : <TrendingDown size={13} aria-hidden />}
            {Math.abs(trendPct!).toFixed(0)}%
          </span>
        )}
      </div>
      {caption && <p className="mt-1 text-xs text-fg-muted">{caption}</p>}

      {pct !== undefined && (
        <div className="mt-auto pt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-900/[0.06]">
            <div className={cn("h-full rounded-full transition-[width] duration-slow ease-smooth", t.bar)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
          </div>
        </div>
      )}
    </Card>
  );
}
