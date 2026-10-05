"use client";

import { useMemo } from "react";
import type { RevenuePoint } from "@/lib/api/admin-analytics";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { RevenueChart } from "@/components/admin/revenue-chart";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS = [7, 30, 90] as const;
export type RevenueRangeDays = (typeof RANGE_OPTIONS)[number];

interface RevenueChartCardProps {
  series?: RevenuePoint[];
  range: RevenueRangeDays;
  onRangeChange: (days: RevenueRangeDays) => void;
  loading?: boolean;
}

export function RevenueChartCard({ series, range, onRangeChange, loading }: RevenueChartCardProps) {
  const { total, totalOrders } = useMemo(() => {
    if (!series) return { total: 0, totalOrders: 0 };
    return series.reduce(
      (acc, p) => ({ total: acc.total + p.revenue, totalOrders: acc.totalOrders + p.orders }),
      { total: 0, totalOrders: 0 },
    );
  }, [series]);

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Realised net sales</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <p className="font-display text-3xl tracking-tight text-ink-900 sm:text-4xl">
              {series ? formatPrice(total) : "—"}
            </p>
            <span className="text-sm text-ink-400">last {range} days</span>
          </div>
          <p className="mt-1.5 text-sm text-ink-500">{series ? `${totalOrders} order${totalOrders === 1 ? "" : "s"} in this period` : "Loading…"}</p>
        </div>

        {/* Range control for this chart only; it doesn't touch the 30-day queries other cards rely on. */}
        <SegmentedControl
          aria-label="Revenue range"
          className="self-start"
          options={RANGE_OPTIONS.map((days) => ({ value: days, label: `${days}D` }))}
          value={range}
          onChange={onRangeChange}
        />
      </div>

      <div className={cn("mt-6 transition-opacity duration-200 ease-smooth", loading && "opacity-40")}>
        {series ? <RevenueChart data={series} /> : <Skeleton className="h-[17.5rem] rounded-2xl" />}
      </div>
    </Card>
  );
}
