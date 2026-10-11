"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { metricDefinition, type MetricGrouping } from "@clothing-brand/shared";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/tabs";
import { getMetrics, type MetricsParams } from "@/lib/api/metrics";
import { GROUPING_LABEL, metricDrillHref } from "@/lib/admin/metric-drill";
import { formatCount, formatPrice } from "@/lib/format";
import { paymentMethodLabel } from "@/components/admin/orders/order-filters";

/** Groupings offered first — the breakdowns an owner asks for most; time comes last. */
const PREFERRED: readonly MetricGrouping[] = ["payment_method", "product", "category", "customer", "brand", "day", "month"];

export interface DrillTarget {
  metric: string;
  /** The range the tile showed: a preset ("this_month") or inclusive business dates. */
  range: Pick<MetricsParams, "preset" | "from" | "to">;
  /** Caption for the range, e.g. "This month". */
  rangeLabel: string;
}

/**
 * Drill into one registry metric (Blueprint V2 P6): the same number broken down by the groupings the registry allows for
 * it, each group linking to its filtered list, product or customer. Every value comes from the metrics engine.
 */
export function MetricDrillDown({ target, onClose }: { target: DrillTarget | null; onClose: () => void }) {
  const def = target ? metricDefinition(target.metric) : undefined;
  const groupings = def ? PREFERRED.filter((g) => def.groupings.includes(g)) : [];
  const [grouping, setGrouping] = useState<MetricGrouping | null>(null);
  const active = grouping && groupings.includes(grouping) ? grouping : (groupings[0] ?? null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["metric-drill", target?.metric, target?.range, active],
    queryFn: () => getMetrics({ metrics: [target!.metric], ...target!.range, groupBy: active!, limit: 50 }),
    enabled: Boolean(target && active),
  });

  const fmt = (v: number) => (def?.unit === "money" ? formatPrice(v) : def?.unit === "ratio" ? `${(v * 100).toFixed(1)}%` : formatCount(v));
  const isTime = active === "day" || active === "month";
  const rows = (data?.groups ?? [])
    .map((g) => ({ key: g.key, label: active === "payment_method" ? paymentMethodLabel(g.key) : g.label, value: g.metrics[target?.metric ?? ""] ?? 0 }))
    .filter((r) => isTime || r.value !== 0)
    .sort((a, b) => (isTime ? a.key.localeCompare(b.key) : b.value - a.value));
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));

  return (
    <Drawer open={Boolean(target)} onClose={onClose} title={def ? def.label : "Breakdown"} widthClassName="max-w-xl">
      {target && def && (
        <div className="space-y-4 px-6 py-5">
          <div>
            <p className="text-[13px] text-fg-muted">
              {target.rangeLabel}
              {data && <> · total {fmt(data.metrics[target.metric]?.value ?? 0)}</>}
            </p>
            <p className="mt-1 text-[12px] text-fg-subtle">{def.description}</p>
          </div>
          {groupings.length > 1 && (
            <SegmentedControl
              aria-label="Break down by"
              value={active!}
              onChange={(g) => setGrouping(g)}
              options={groupings.map((g) => ({ value: g, label: GROUPING_LABEL[g] }))}
            />
          )}
          {groupings.length === 0 && <p className="text-[13px] text-fg-muted">This number has no breakdown in the registry.</p>}
          {isError && !data && <ErrorState onRetry={() => refetch()} />}
          {isLoading && <div className="h-48 animate-pulse rounded-xl bg-ink-900/[0.04]" aria-busy="true" aria-label="Loading" />}
          {data && rows.length === 0 && <EmptyState icon={BarChart3} title="Nothing in this range" />}
          {rows.length > 0 && (
            <ul className="space-y-2" aria-label={`${def.label} by ${GROUPING_LABEL[active!].toLowerCase()}`}>
              {rows.map((r) => {
                const href = metricDrillHref(active!, r.key);
                const label = (
                  <span className="truncate" title={r.label}>
                    {r.label}
                  </span>
                );
                return (
                  <li key={r.key} className="text-[13px]">
                    <div className="flex items-baseline justify-between gap-3">
                      {href ? (
                        <Link href={href} className="min-w-0 truncate text-accent hover:underline">
                          {label}
                        </Link>
                      ) : (
                        <span className="min-w-0 truncate text-fg">{label}</span>
                      )}
                      <span className="shrink-0 font-medium tabular-nums text-fg">{fmt(r.value)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-ink-900/[0.05]">
                      <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Drawer>
  );
}
