import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatTileProps {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: "default" | "warning";
  /** Percent change vs. the prior period, e.g. from computeTrend() — omit when no baseline exists (e.g. pending orders). */
  trendPct?: number | null;
}

export function StatTile({ label, value, icon, tone = "default", trendPct }: StatTileProps) {
  const hasTrend = trendPct !== null && trendPct !== undefined && Number.isFinite(trendPct);
  const isUp = hasTrend && trendPct! >= 0;

  return (
    <Card className="flex items-center gap-4 p-5">
      <div className={tone === "warning" ? "text-warning-600" : "text-brass-500"}>{icon}</div>
      <div>
        <p className="text-xs uppercase tracking-wide text-ink-500">{label}</p>
        <div className="mt-0.5 flex items-baseline gap-2">
          <p className="font-sans text-2xl font-semibold tracking-tight text-ink-900">{value}</p>
          {hasTrend && (
            <span
              className={cn(
                "flex items-center gap-0.5 text-xs font-medium",
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
