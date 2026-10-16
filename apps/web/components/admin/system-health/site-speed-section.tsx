"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { PAGE_KINDS, type DeviceKind, type PageKind, type VitalRating, type WebVitalMetric } from "@clothing-brand/shared";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/tabs";
import * as opsApi from "@/lib/api/ops";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAYS = 7;
/** Below this many visits a percentile still moves a lot — shown, but marked as early. */
const FEW_VISITS = 20;

const DEVICE_OPTIONS = [
  { value: "mobile", label: "Phone" },
  { value: "desktop", label: "Computer" },
] as const;

const PAGE_LABEL: Record<PageKind, string> = {
  home: "Home page",
  category: "Category pages",
  product: "Product pages",
  search: "Search",
  cart: "Cart",
  checkout: "Checkout",
  landing: "Ad landing pages",
  account: "Customer account",
  other: "Other pages",
};

/** The three Google uses to judge a page, in the owner's words. */
const SHOWN: Array<{ metric: WebVitalMetric; label: string; help: string }> = [
  { metric: "LCP", label: "Loads", help: "Largest Contentful Paint — time until the main picture or text is on screen" },
  { metric: "INP", label: "Responds", help: "Interaction to Next Paint — delay between a tap and the page reacting" },
  { metric: "CLS", label: "Steady", help: "Cumulative Layout Shift — how much the page jumps while loading (lower is better)" },
];

const RATING: Record<VitalRating, { label: string; className: string }> = {
  good: { label: "Good", className: "bg-success-50 text-success-700" },
  "needs-improvement": { label: "Needs work", className: "bg-warning-50 text-warning-700" },
  poor: { label: "Slow", className: "bg-danger-50 text-danger-600" },
};

function formatVital(metric: WebVitalMetric, value: number): string {
  if (metric === "CLS") return value.toFixed(2);
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function MetricCell({ label, help, row }: { label: string; help: string; row?: opsApi.VitalRow }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-fg-muted" title={help}>
        {label}
      </p>
      {row ? (
        <p className="mt-1 flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-1.5">
          <span className="text-[15px] font-semibold tabular-nums text-fg">{formatVital(row.metric, row.p75)}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", RATING[row.rating].className)}>{RATING[row.rating].label}</span>
        </p>
      ) : (
        <p className="mt-1 text-[15px] text-fg-subtle">—</p>
      )}
    </div>
  );
}

/** Admin › System health › Site speed (Site health): how fast the store is for real customers over the last 7 days, per
 * kind of page, on phones or computers. Each number is the 75th percentile — three in four visits were at least this fast. */
export function SiteSpeedSection() {
  const [device, setDevice] = useState<DeviceKind>("mobile");
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: opsApi.vitalsKeys.window(DAYS), queryFn: () => opsApi.getVitals(DAYS), refetchInterval: 5 * 60_000 });

  const rows = data?.rows.filter((r) => r.device === device) ?? [];
  const pages = PAGE_KINDS.filter((kind) => rows.some((r) => r.pageKind === kind));

  return (
    <section id="speed" aria-labelledby="speed-heading" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-xl">
          <h2 id="speed-heading" className="font-display text-lg tracking-tight text-fg">
            Site speed
          </h2>
          <p className="text-[13px] text-fg-muted">
            How fast the store is for real customers in the last {DAYS} days: how soon the main content shows, how quickly a tap gets a response, and
            how much the page jumps. Three in four visits were at least this fast.
          </p>
        </div>
        <SegmentedControl aria-label="Device" options={DEVICE_OPTIONS} value={device} onChange={setDevice} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        {isError && !data ? (
          <ErrorState onRetry={() => refetch()} className="py-10" />
        ) : isLoading || !data ? (
          <div className="h-40 animate-pulse bg-ink-900/[0.03]" aria-busy="true" aria-label="Loading" />
        ) : pages.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title="Collecting speed data"
            description={`Numbers appear after a few dozen ${device === "mobile" ? "phone" : "computer"} visits from customers.`}
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {pages.map((kind) => {
              const byMetric = new Map(rows.filter((r) => r.pageKind === kind).map((r) => [r.metric, r]));
              const visits = Math.max(...[...byMetric.values()].map((r) => r.samples));
              return (
                <li key={kind} data-testid="speed-row" className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-center sm:gap-6">
                  <div>
                    <p className="text-[15px] font-medium text-fg">{PAGE_LABEL[kind]}</p>
                    <p className="text-xs text-fg-subtle">
                      {formatCount(visits)} visit{visits === 1 ? "" : "s"}
                      {visits < FEW_VISITS ? " · early numbers" : ""}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {SHOWN.map((m) => (
                      <MetricCell key={m.metric} label={m.label} help={m.help} row={byMetric.get(m.metric)} />
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
