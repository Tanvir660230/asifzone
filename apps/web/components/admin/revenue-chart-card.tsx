"use client";

import { useMemo } from "react";
import type { RevenuePoint } from "@/lib/api/admin-analytics";
import { Card } from "@/components/ui/card";
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
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Revenue</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <p className="font-display text-3xl tracking-tight text-ink-900 sm:text-4xl">
              {series ? formatPrice(total) : "—"}
            </p>
            <span className="text-sm text-ink-400">last {range} days</span>
          </div>
          <p className="mt-1.5 text-sm text-ink-500">{series ? `${totalOrders} order${totalOrders === 1 ? "" : "s"} in this period` : "Loading…"}</p>
        </div>

        {/* Segmented range control — an explicit, self-contained filter for this chart only; it
            doesn't touch the 30-day queries other cards on the dashboard rely on. */}
        <div className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-full border border-ink-100 bg-ink-50/60 p-1">
          {RANGE_OPTIONS.map((days) => (
            <button
              key={days}
              onClick={() => onRangeChange(days)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ease-smooth",
                range === days ? "bg-ink-900 text-cream-50 shadow-sm" : "text-ink-500 hover:text-ink-900",
              )}
            >
              {days}D
            </button>
          ))}
        </div>
      </div>

      <div className={cn("mt-6 transition-opacity duration-200 ease-smooth", loading && "opacity-40")}>
        {series ? <RevenueChart data={series} /> : <div className="h-[17.5rem] animate-pulse rounded-2xl bg-ink-50" />}
      </div>
    </Card>
  );
}
