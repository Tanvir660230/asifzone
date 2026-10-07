import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

interface MetricCardProps {
  label: string;
  /** Already formatted (formatPrice, a count…). The card never computes a business number (Blueprint V2 §J8). */
  value: string;
  /** One quiet line under the value: what the number covers, or a related figure. */
  detail?: ReactNode;
  /** Percent change vs. the comparison period — omit when no baseline exists. */
  trendPct?: number | null;
  /** Names the comparison for the trend chip ("vs last 30 days"). */
  trendLabel?: string;
  /** A small series drawn under the value (oldest first). */
  sparkline?: number[];
  /** `attention`: the number is waiting on someone (> 0 callers only) — an amber dot, nothing louder. */
  tone?: "default" | "attention";
  href?: string;
  onClick?: () => void;
  className?: string;
}

/** The admin's KPI card: label, one big number, an optional trend and sparkline. White, hairline-bordered, no lift — the
 * Store Console's flat card language. Clickable when it leads to the list or report behind the number. */
export function MetricCard({ label, value, detail, trendPct, trendLabel, sparkline, tone = "default", href, onClick, className }: MetricCardProps) {
  const hasTrend = trendPct !== null && trendPct !== undefined && Number.isFinite(trendPct);
  const up = hasTrend && trendPct! >= 0;
  const interactive = Boolean(href || onClick);

  const body = (
    <div
      className={cn(
        "group flex h-full flex-col rounded-xl border border-line bg-surface p-5 shadow transition-colors duration-fast ease-smooth",
        interactive && "hover:border-line-strong",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {tone === "attention" && <span className="h-2 w-2 shrink-0 rounded-full bg-warning-500" aria-hidden />}
        <p className="truncate text-[13px] font-medium text-fg-muted">{label}</p>
        {interactive && <ChevronRight size={14} className="ml-auto shrink-0 text-ink-300 transition-colors group-hover:text-ink-500" aria-hidden />}
      </div>
      <p className="mt-2 truncate text-[28px] font-semibold leading-none tracking-tight tabular-nums text-fg">{value}</p>
      {(hasTrend || detail) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-muted">
          {hasTrend && (
            <span className={cn("inline-flex items-center gap-0.5 font-semibold", up ? "text-success-700" : "text-danger-600")}>
              {up ? <TrendingUp size={13} aria-hidden /> : <TrendingDown size={13} aria-hidden />}
              {Math.abs(trendPct!).toFixed(0)}%
              <span className="sr-only">{up ? "up" : "down"}</span>
            </span>
          )}
          {hasTrend && trendLabel && <span>{trendLabel}</span>}
          {detail && <span className="min-w-0 truncate">{detail}</span>}
        </div>
      )}
      {sparkline && sparkline.length > 1 && <Sparkline data={sparkline} className="mt-auto h-10 w-full pt-3 text-accent" />}
    </div>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={`${label}: ${value}`} className="block h-full w-full rounded-xl text-left">
        {body}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} aria-label={`${label}: ${value}`} className="block h-full rounded-xl">
        {body}
      </Link>
    );
  }
  return body;
}

/** Same footprint as a MetricCard, so the grid doesn't jump when data arrives. */
export function MetricCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface p-5", className)} aria-hidden>
      <div className="h-3.5 w-24 rounded ui-skeleton" />
      <div className="mt-3 h-7 w-28 rounded ui-skeleton" />
      <div className="mt-3 h-3 w-20 rounded ui-skeleton" />
    </div>
  );
}

/** A row of small live figures inside one card, divided by hairlines — for numbers that don't each deserve a card. */
export function MetricStrip({ items, className }: { items: { label: string; value: string; href?: string; onClick?: () => void }[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 divide-y divide-line-subtle rounded-xl border border-line bg-surface shadow sm:grid-cols-3 sm:divide-x sm:divide-y-0", className)}>
      {items.map((item) => {
        const inner = (
          <>
            <span className="text-[13px] text-fg-muted">{item.label}</span>
            <span className="text-[15px] font-semibold tabular-nums text-fg">{item.value}</span>
          </>
        );
        const cls = "flex items-center justify-between gap-3 px-5 py-3.5";
        if (item.onClick) {
          return (
            <button key={item.label} type="button" onClick={item.onClick} className={cn(cls, "text-left transition-colors hover:bg-ink-900/[0.02]")}>
              {inner}
            </button>
          );
        }
        if (item.href) {
          return (
            <Link key={item.label} href={item.href} className={cn(cls, "transition-colors hover:bg-ink-900/[0.02]")}>
              {inner}
            </Link>
          );
        }
        return (
          <div key={item.label} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
