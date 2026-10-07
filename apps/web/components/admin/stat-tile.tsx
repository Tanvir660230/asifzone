import type { ReactNode } from "react";
import Link from "next/link";
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
  /** Makes the whole tile a link to the list behind the number (e.g. "Pending" → the orders list filtered to pending). */
  href?: string;
  /** Alternative to `href` for a tile that opens something in place (e.g. a drawer). */
  onClick?: () => void;
}

/** The corner icon's colour carries the tone — nothing else on the card changes colour. */
const TONE_ICON: Record<NonNullable<StatTileProps["tone"]>, string> = {
  default: "text-ink-400",
  warning: "text-warning-600",
  accent: "text-accent",
};

export function StatTile({ label, value, icon, tone = "default", trendPct, href, onClick }: StatTileProps) {
  const hasTrend = trendPct !== null && trendPct !== undefined && Number.isFinite(trendPct);
  const isUp = hasTrend && trendPct! >= 0;
  const interactive = Boolean(href || onClick);

  // Same card language as MetricCard: label first, one big number, the icon small in the corner (Store Console surface).
  const tile = (
    <Card className={cn("group relative flex h-full flex-col p-5 transition-colors duration-fast ease-smooth", interactive && "hover:border-line-strong")}>
      <div className="flex items-start gap-2">
        {/* A tile only ever gets tone="warning" when its underlying count is actually > 0 (callers gate it). */}
        {tone === "warning" && <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-warning-500" aria-hidden />}
        <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-fg-muted">{label}</p>
        <span className={cn("shrink-0 [&>svg]:h-4 [&>svg]:w-4", TONE_ICON[tone])} aria-hidden>
          {icon}
        </span>
      </div>
      {/* flex-wrap, not truncate, on this row — the value is the whole point of the tile, so if the trend doesn't fit
          beside it the trend wraps instead of the number being cut. The value keeps `truncate` only as a floor for
          pathological widths (it has no spaces to wrap on); its full text is in the title. */}
      <div className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-2">
        <p title={value} className="max-w-full truncate text-[26px] font-semibold leading-tight tracking-tight tabular-nums text-fg">
          {value}
        </p>
        {hasTrend && (
          <span className={cn("flex shrink-0 items-center gap-0.5 text-[12.5px] font-semibold", isUp ? "text-success-700" : "text-danger-600")}>
            {isUp ? <TrendingUp size={13} aria-hidden /> : <TrendingDown size={13} aria-hidden />}
            {Math.abs(trendPct!).toFixed(0)}%
          </span>
        )}
      </div>
    </Card>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}: ${value}`}
        className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {tile}
      </button>
    );
  }
  if (!href) return tile;
  return (
    <Link href={href} aria-label={`${label}: ${value}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {tile}
    </Link>
  );
}

/** Matches StatTile's exact shape so the KPI grid doesn't reflow/pop when the query resolves. */
export function StatTileSkeleton() {
  return (
    <Card className="flex flex-col p-5">
      <div className="h-3.5 w-24 rounded ui-skeleton" />
      <div className="mt-3 h-7 w-20 rounded ui-skeleton" />
    </Card>
  );
}
