"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Info, Wallet, TrendingUp, Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import { CohortRetentionGrid } from "@/components/admin/cohort-retention-grid";
import * as analyticsApi from "@/lib/api/admin-analytics";
import * as biApi from "@/lib/api/bi";
import { formatPrice } from "@/lib/format";

function toBarItems<T>(rows: T[] | undefined, opts: { key: (r: T) => string; label: (r: T) => string; value: (r: T) => number; valueLabel: (r: T) => string }): RankedBarListItem[] {
  return (rows ?? []).map((r) => ({ key: opts.key(r), label: opts.label(r), value: opts.value(r), valueLabel: opts.valueLabel(r) }));
}

export default function LifetimeDataPage() {
  const { data: overview } = useQuery({ queryKey: ["bi-lifetime-overview"], queryFn: biApi.getExecutiveOverview });
  const { data: yearly } = useQuery({ queryKey: ["bi-lifetime-yearly"], queryFn: analyticsApi.getLifetimeYearlyTrend });
  const { data: cohorts } = useQuery({ queryKey: ["bi-lifetime-cohorts"], queryFn: analyticsApi.getCohortRetention });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Lifetime Data</h1>
        <p className="mt-1 text-sm text-ink-500">The store&apos;s all-time numbers, year over year, and how well it holds onto customers.</p>
      </div>

      {/* Lifetime headline figures — reused from the Executive Overview */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">All-time</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {!overview ? (
            Array.from({ length: 4 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Lifetime Revenue" value={formatPrice(overview.revenueLifetime)} icon={<Wallet size={18} />} tone="accent" />
              <StatTile label="Lifetime Orders" value={overview.ordersLifetime.toLocaleString("en-BD")} icon={<TrendingUp size={18} />} />
              <StatTile label="Average Order Value" value={formatPrice(overview.aovLifetime)} icon={<Wallet size={18} />} />
              <StatTile label="Repeat Purchase Rate" value={`${overview.repeatPurchaseRatePct.toFixed(1)}%`} icon={<Repeat size={18} />} />
            </>
          )}
        </div>
      </section>

      {/* Year over year */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Revenue by year</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(yearly?.years, { key: (y) => String(y.year), label: (y) => String(y.year), value: (y) => y.revenue, valueLabel: (y) => `${formatPrice(y.revenue)} · ${y.orders} orders` })}
              emptyLabel="No orders recorded yet."
            />
          </CardContent>
        </Card>
      </section>

      {/* Retention */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Cohort retention</CardTitle>
          </CardHeader>
          <CardContent>{cohorts && <CohortRetentionGrid cohorts={cohorts.cohorts} />}</CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          Per-customer RFM and purchase-frequency detail already live under{" "}
          <Link href="/admin/bi/customers" className="font-medium underline">
            Customer Intelligence
          </Link>{" "}
          — not repeated here to avoid showing the same table twice.
        </p>
      </Card>
    </div>
  );
}
