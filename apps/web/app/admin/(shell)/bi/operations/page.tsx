"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Clock, Truck, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { cn } from "@/lib/utils";

type RangeOption = 7 | 30 | 90 | "all";
const RANGE_OPTIONS: RangeOption[] = [7, 30, 90, "all"];

function toBarItems<T>(rows: T[] | undefined, opts: { key: (r: T) => string; label: (r: T) => string; value: (r: T) => number; valueLabel: (r: T) => string }): RankedBarListItem[] {
  return (rows ?? []).map((r) => ({ key: opts.key(r), label: opts.label(r), value: opts.value(r), valueLabel: opts.valueLabel(r) }));
}

function formatHours(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export default function OperationalAnalyticsPage() {
  const [range, setRange] = useState<RangeOption>(30);
  const apiDays = range === "all" ? undefined : range;

  const { data: fulfillment } = useQuery({ queryKey: ["bi-ops-fulfillment", apiDays], queryFn: () => analyticsApi.getFulfillmentTime(apiDays) });
  const { data: activity } = useQuery({ queryKey: ["bi-ops-activity", apiDays], queryFn: () => analyticsApi.getAdminActivitySummary(apiDays, 10) });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Operational Analytics</h1>
          <p className="mt-1 text-sm text-ink-500">How fast orders move through fulfillment, and who&apos;s doing what in the admin panel.</p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-full border border-ink-100 bg-ink-50/60 p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setRange(opt)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ease-smooth",
                range === opt ? "bg-ink-900 text-cream-50 shadow-sm" : "text-ink-500 hover:text-ink-900",
              )}
            >
              {opt === "all" ? "All" : `${opt}D`}
            </button>
          ))}
        </div>
      </div>

      {/* Fulfillment speed */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Fulfillment speed</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {!fulfillment ? (
            Array.from({ length: 4 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Placed → Shipped" value={formatHours(fulfillment.avgHoursToShip)} icon={<Clock size={18} />} />
              <StatTile label="Shipped → Delivered" value={formatHours(fulfillment.avgHoursShipToDeliver)} icon={<Truck size={18} />} />
              <StatTile label="Placed → Delivered" value={formatHours(fulfillment.avgHoursToDeliver)} icon={<CheckCircle2 size={18} />} tone="accent" />
              <StatTile label="Delivered orders (basis)" value={fulfillment.deliveredOrders.toLocaleString("en-BD")} icon={<CheckCircle2 size={18} />} />
            </>
          )}
        </div>
      </section>

      {/* Admin activity */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Most active admins</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(activity?.byAdmin, { key: (a) => a.id, label: (a) => a.name, value: (a) => a.actions, valueLabel: (a) => a.actions.toLocaleString("en-BD") })}
              emptyLabel="No admin activity recorded yet for this range."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Most common actions</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(activity?.byAction, { key: (a) => a.action, label: (a) => a.action, value: (a) => a.count, valueLabel: (a) => a.count.toLocaleString("en-BD") })}
              emptyLabel="No admin activity recorded yet for this range."
            />
          </CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          API error rate and request-performance monitoring aren&apos;t shown — no request or error log exists in the database today;
          that needs new server instrumentation (e.g. an APM tool), not a query against existing data.
        </p>
      </Card>
    </div>
  );
}
