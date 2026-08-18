"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, XCircle, ShoppingBag, LogOut, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { ConversionMetricCard } from "@/components/admin/conversion-metric-card";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type RangeOption = 7 | 30 | 90 | "all";
const RANGE_OPTIONS: RangeOption[] = [7, 30, 90, "all"];

export default function SearchAnalyticsPage() {
  const [range, setRange] = useState<RangeOption>(30);
  const apiDays = range === "all" ? undefined : range;
  const legacyDays = range === "all" ? 365 : range;

  const { data: overview } = useQuery({ queryKey: ["bi-search-overview", legacyDays], queryFn: () => analyticsApi.getSearchAnalytics(legacyDays, 10) });
  const { data: trends } = useQuery({ queryKey: ["bi-search-trends"], queryFn: () => analyticsApi.getSearchTrends(10) });
  const { data: noResults } = useQuery({ queryKey: ["bi-search-no-result", apiDays], queryFn: () => analyticsApi.getNoResultSearches(apiDays, 20) });
  const { data: conversion } = useQuery({ queryKey: ["bi-search-conversion", apiDays], queryFn: () => analyticsApi.getSearchConversion(apiDays) });
  const { data: audience } = useQuery({ queryKey: ["bi-search-audience", apiDays], queryFn: () => analyticsApi.getSearchAudience(apiDays) });
  const { data: cities } = useQuery({ queryKey: ["bi-search-cities", apiDays], queryFn: () => analyticsApi.getSearchesByCity(apiDays, 8) });

  const trendItems: RankedBarListItem[] = (trends?.queries ?? []).map((t, i) => ({
    key: `${t.query}-${i}`,
    label: t.query,
    value: t.recentCount,
    valueLabel: `${t.recentCount} (${t.growthPct >= 0 ? "+" : ""}${t.growthPct.toFixed(0)}%)`,
  }));

  const cityItems: RankedBarListItem[] = (cities?.cities ?? []).map((c, i) => ({
    key: `${c.city}-${i}`,
    label: c.city,
    value: c.sessions,
    valueLabel: c.sessions.toLocaleString("en-BD"),
  }));

  const deviceItems: RankedBarListItem[] = (audience?.devices ?? []).map((d, i) => ({
    key: `${d.device}-${i}`,
    label: d.device,
    value: d.sessions,
    valueLabel: d.sessions.toLocaleString("en-BD"),
  }));

  const customerTypeItems: RankedBarListItem[] = audience
    ? [
        { key: "guest", label: "Guest", value: audience.guest, valueLabel: audience.guest.toLocaleString("en-BD") },
        { key: "logged-in", label: "Logged In", value: audience.loggedIn, valueLabel: audience.loggedIn.toLocaleString("en-BD") },
      ]
    : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Search Analytics</h1>
          <p className="mt-1 text-sm text-ink-500">What shoppers type, what the catalog can&apos;t answer, and where it leads.</p>
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

      {/* Overview — reuses the existing getSearchAnalytics endpoint, not rebuilt here. */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Overview</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {!overview ? (
            Array.from({ length: 3 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Total Searches" value={overview.totalSearches.toLocaleString("en-BD")} icon={<Search size={18} />} />
              <ConversionMetricCard
                label="Zero-Result Rate"
                value={`${overview.zeroResultRate.toFixed(1)}%`}
                icon={<XCircle size={18} />}
                pct={overview.zeroResultRate}
                tone={overview.zeroResultRate > 20 ? "warning" : "default"}
              />
              <StatTile label="Zero-Result Searches" value={overview.zeroResultSearches.toLocaleString("en-BD")} icon={<XCircle size={18} />} />
            </>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Popular queries</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={(overview?.topQueries ?? []).map((q, i) => ({ key: `${q.query}-${i}`, label: q.query, value: q.count, valueLabel: q.count.toLocaleString("en-BD") }))}
              emptyLabel="No searches recorded yet for this range."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Trending queries (7d vs prior 7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList items={trendItems} emptyLabel="Not enough search history yet to detect a trend." />
          </CardContent>
        </Card>
      </section>

      {/* No-result / misspelled / suggestions — one table serves all three, since they're the
          same underlying rows viewed once. */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>No-result searches &amp; suggestions</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!noResults || noResults.queries.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No zero-result searches for this range.</p>
            ) : (
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Query</th>
                    <th className="pb-2 pr-4">Times searched</th>
                    <th className="pb-2 pr-4">Last searched</th>
                    <th className="pb-2">Suggested instead</th>
                  </tr>
                </thead>
                <tbody>
                  {noResults.queries.map((row) => (
                    <tr key={row.query} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 font-medium text-ink-800">{row.query}</td>
                      <td className="py-2 pr-4 text-ink-600">{row.count}</td>
                      <td className="py-2 pr-4 text-ink-500">{formatDate(row.lastSearchedAt)}</td>
                      <td className="py-2">
                        {row.suggestion ? (
                          <span className="rounded-full bg-info-50 px-2 py-0.5 text-xs font-medium text-info-600">{row.suggestion}</span>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Search → outcome */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Where Searches Lead</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {!conversion ? (
            Array.from({ length: 2 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <ConversionMetricCard
                label="Searches Leading to Purchase"
                value={`${conversion.purchaseRatePct.toFixed(1)}%`}
                caption={`${conversion.purchasedSessions.toLocaleString("en-BD")} of ${conversion.searchSessions.toLocaleString("en-BD")} correlated search sessions`}
                icon={<ShoppingBag size={18} />}
                pct={conversion.purchaseRatePct}
                tone="accent"
              />
              <ConversionMetricCard
                label="Searches Leading to Exit"
                value={`${conversion.exitRatePct.toFixed(1)}%`}
                caption={`${conversion.exitedSessions.toLocaleString("en-BD")} left right after searching`}
                icon={<LogOut size={18} />}
                pct={conversion.exitRatePct}
                tone={conversion.exitRatePct > 40 ? "warning" : "default"}
              />
            </>
          )}
        </div>
      </section>

      {/* Search audience */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Searches by device</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList items={deviceItems} emptyLabel="No correlated search sessions yet." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Searches by customer type</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList items={customerTypeItems} emptyLabel="No correlated search sessions yet." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Searches by city</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList items={cityItems} emptyLabel="No location data yet." />
          </CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          &ldquo;Where Searches Lead&rdquo; and &ldquo;Search Audience&rdquo; only cover searches the browser had time to correlate to a
          session after the results page loaded — a small, growing subset until this rolls out further, not every search recorded above.
        </p>
      </Card>
    </div>
  );
}
