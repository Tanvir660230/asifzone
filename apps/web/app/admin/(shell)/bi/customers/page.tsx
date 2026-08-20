"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Wallet, Receipt, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import { CohortRetentionGrid } from "@/components/admin/cohort-retention-grid";
import * as analyticsApi from "@/lib/api/admin-analytics";
import * as biApi from "@/lib/api/bi";
import * as customersApi from "@/lib/api/admin-customers";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type RangeOption = 7 | 30 | 90 | "all";
const RANGE_OPTIONS: RangeOption[] = [7, 30, 90, "all"];

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

function toBarItems<T>(rows: T[] | undefined, opts: { key: (r: T) => string; label: (r: T) => string; value: (r: T) => number; valueLabel: (r: T) => string }): RankedBarListItem[] {
  return (rows ?? []).map((r) => ({ key: opts.key(r), label: opts.label(r), value: opts.value(r), valueLabel: opts.valueLabel(r) }));
}

export default function CustomerIntelligencePage() {
  const [range, setRange] = useState<RangeOption>(30);
  const apiDays = range === "all" ? undefined : range;
  const legacyDays = range === "all" ? 365 : range;

  const { data: overview } = useQuery({ queryKey: ["bi-customers-overview"], queryFn: biApi.getExecutiveOverview });
  const { data: stats } = useQuery({ queryKey: ["bi-customers-stats"], queryFn: customersApi.getCustomerStats });

  const { data: rfm } = useQuery({ queryKey: ["bi-customers-rfm"], queryFn: () => analyticsApi.getCustomerRfmTable(50) });
  const { data: frequency } = useQuery({ queryKey: ["bi-customers-frequency"], queryFn: analyticsApi.getPurchaseFrequencyDistribution });

  const { data: categories } = useQuery({ queryKey: ["bi-customers-categories", legacyDays], queryFn: () => analyticsApi.getTopCategories(legacyDays, 8) });
  const { data: sizeColor } = useQuery({ queryKey: ["bi-customers-size-color", apiDays], queryFn: () => analyticsApi.getSizeColorPerformance(apiDays) });
  const { data: paymentMethod } = useQuery({ queryKey: ["bi-customers-payment", apiDays], queryFn: () => analyticsApi.getFavoritePaymentMethod(apiDays) });

  const { data: location } = useQuery({ queryKey: ["bi-customers-location", apiDays], queryFn: () => analyticsApi.getCustomerLocationBreakdown(apiDays, 8) });

  const { data: timing } = useQuery({ queryKey: ["bi-customers-timing", apiDays], queryFn: () => analyticsApi.getPurchaseTimeDistribution(apiDays) });

  const { data: cohorts } = useQuery({ queryKey: ["bi-customers-cohorts"], queryFn: analyticsApi.getCohortRetention });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Customer Intelligence</h1>
          <p className="mt-1 text-sm text-ink-500">Who buys, how often, what they prefer, and who needs attention.</p>
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

      {/* Value */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Value</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {!overview ? (
            Array.from({ length: 2 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Lifetime Customer Value" value={formatPrice(overview.customerLifetimeValue)} icon={<Wallet size={18} />} tone="accent" />
              <StatTile label="Average Order Value" value={formatPrice(overview.aovLifetime)} icon={<Receipt size={18} />} />
            </>
          )}
        </div>
      </section>

      {/* Segments — reused directly from the customers list's own stats endpoint, so counts here
          always match filtering the customers list by the same tag. */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Segments (lifetime)</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
          {!stats ? (
            Array.from({ length: 10 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Total Customers" value={stats.totalCustomers.toLocaleString("en-BD")} icon={<Wallet size={18} />} />
              <StatTile label="VIP" value={stats.vipCustomers.toLocaleString("en-BD")} icon={<Wallet size={18} />} tone="accent" />
              <StatTile label="Returning" value={stats.repeatCustomers.toLocaleString("en-BD")} icon={<Wallet size={18} />} />
              <StatTile label="One-Time Buyers" value={stats.oneTimeBuyers.toLocaleString("en-BD")} icon={<Wallet size={18} />} />
              <StatTile label="New This Month" value={stats.newThisMonth.toLocaleString("en-BD")} icon={<Wallet size={18} />} />
              <StatTile label="Inactive (90d)" value={stats.inactive90.toLocaleString("en-BD")} icon={<Wallet size={18} />} tone={stats.inactive90 > 0 ? "warning" : "default"} />
              <StatTile label="High-Risk (Suspicious)" value={stats.suspiciousCount.toLocaleString("en-BD")} icon={<Wallet size={18} />} tone={stats.suspiciousCount > 0 ? "warning" : "default"} />
              <StatTile label="COD Risk" value={stats.codRiskCount.toLocaleString("en-BD")} icon={<Wallet size={18} />} tone={stats.codRiskCount > 0 ? "warning" : "default"} />
              <StatTile label="Blocked" value={stats.blockedCount.toLocaleString("en-BD")} icon={<Wallet size={18} />} />
              <StatTile label="Lifetime Revenue" value={formatPrice(stats.lifetimeRevenue)} icon={<Wallet size={18} />} tone="accent" />
            </>
          )}
        </div>
      </section>

      {/* RFM & frequency */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>RFM — top customers by lifetime value</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!rfm || rfm.customers.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No customers with orders yet.</p>
            ) : (
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Customer</th>
                    <th className="pb-2 pr-4">Recency</th>
                    <th className="pb-2 pr-4">Frequency</th>
                    <th className="pb-2 pr-4">Monetary</th>
                    <th className="pb-2">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {rfm.customers.map((c) => (
                    <tr key={c.id} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 font-medium text-ink-800">
                        <Link href={`/admin/customers/${c.id}`} className="hover:text-brass-600">
                          {c.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-ink-600">{c.recencyDays === null ? "—" : `${c.recencyDays}d ago`}</td>
                      <td className="py-2 pr-4 text-ink-600">{c.frequency}</td>
                      <td className="py-2 pr-4 text-ink-800">{formatPrice(c.monetary)}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {c.tags.map((t) => (
                            <span key={t} className="rounded-full bg-ink-50 px-2 py-0.5 text-[11px] font-medium text-ink-600">
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Purchase frequency (lifetime)</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(frequency?.buckets, {
                key: (b) => b.bucket,
                label: (b) => b.bucket,
                value: (b) => b.customers,
                valueLabel: (b) => b.customers.toLocaleString("en-BD"),
              })}
              emptyLabel="No purchase history yet."
            />
          </CardContent>
        </Card>
      </section>

      {/* Preferences */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Preferred category</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(categories?.categories, {
                key: (c) => c.name,
                label: (c) => c.name,
                value: (c) => c.revenue,
                valueLabel: (c) => formatPrice(c.revenue),
              })}
              emptyLabel="No sales recorded yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Favorite payment method</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(paymentMethod?.methods, {
                key: (m) => m.method,
                label: (m) => m.method,
                value: (m) => m.orders,
                valueLabel: (m) => `${m.orders} · ${formatPrice(m.revenue)}`,
              })}
              emptyLabel="No orders recorded yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Favorite size</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(sizeColor?.sizes, {
                key: (s) => s.value,
                label: (s) => s.value,
                value: (s) => s.unitsSold,
                valueLabel: (s) => s.unitsSold.toLocaleString("en-BD"),
              })}
              emptyLabel="No sales recorded yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Favorite color</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(sizeColor?.colors, {
                key: (c) => c.value,
                label: (c) => c.value,
                value: (c) => c.unitsSold,
                valueLabel: (c) => c.unitsSold.toLocaleString("en-BD"),
              })}
              emptyLabel="No sales recorded yet."
            />
          </CardContent>
        </Card>
      </section>

      {/* Location */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By division</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(location?.divisions, {
                key: (d) => d.division,
                label: (d) => d.division,
                value: (d) => d.orders,
                valueLabel: (d) => `${d.orders} · ${formatPrice(d.revenue)}`,
              })}
              emptyLabel="No orders recorded yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By district</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(location?.districts, {
                key: (d) => d.district,
                label: (d) => d.district,
                value: (d) => d.orders,
                valueLabel: (d) => `${d.orders} · ${formatPrice(d.revenue)}`,
              })}
              emptyLabel="No orders recorded yet."
            />
          </CardContent>
        </Card>
      </section>

      {/* Timing */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Most purchased hour</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(timing?.byHour, {
                key: (h) => String(h.hour),
                label: (h) => formatHourLabel(h.hour),
                value: (h) => h.orders,
                valueLabel: (h) => h.orders.toLocaleString("en-BD"),
              })}
              emptyLabel="No orders recorded yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Most purchased day</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(timing?.byDayOfWeek, {
                key: (d) => String(d.dow),
                label: (d) => DOW_LABELS[d.dow] ?? String(d.dow),
                value: (d) => d.orders,
                valueLabel: (d) => d.orders.toLocaleString("en-BD"),
              })}
              emptyLabel="No orders recorded yet."
            />
          </CardContent>
        </Card>
      </section>

      {/* Lifetime history — reused directly from the existing cohort retention grid. */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Lifetime history — cohort retention</CardTitle>
          </CardHeader>
          <CardContent>{cohorts && <CohortRetentionGrid cohorts={cohorts.cohorts} />}</CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          Age and gender aren&apos;t shown — nothing collects them today, and adding that would need new profile fields plus a UX to
          collect them, not just a report. Favorite courier isn&apos;t shown either — Steadfast is this store&apos;s only integrated
          courier, so that breakdown would just be a constant, not a real signal. A single customer&apos;s own order history and
          timeline already live on their profile page under Customers.
        </p>
      </Card>
    </div>
  );
}
