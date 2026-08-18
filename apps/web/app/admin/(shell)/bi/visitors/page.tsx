"use client";

import { useQuery } from "@tanstack/react-query";
import { Users, Repeat, Globe2, FileText, LogIn, Radio, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { ConversionMetricCard } from "@/components/admin/conversion-metric-card";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import * as biApi from "@/lib/api/bi";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { formatDuration } from "@/lib/format";
import { useBiDateRange } from "@/components/admin/bi-date-range-context";

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function VisitorAnalyticsPage() {
  // Driven by the shared BI date-range picker (app/admin/(shell)/bi/layout.tsx) rather than a
  // local pill picker — an explicit dateFrom/dateTo always wins over the legacy `days` lookback
  // (see resolveDateRange in analytics.service.ts), so `days` is left undefined everywhere below.
  const { range } = useBiDateRange();
  const rangeKey = `${range.from.toISOString()}:${range.to.toISOString()}`;

  const { data: overview } = useQuery({ queryKey: ["bi-overview-for-visitors"], queryFn: biApi.getExecutiveOverview });
  const { data: funnel } = useQuery({
    queryKey: ["bi-visitors-funnel", rangeKey],
    queryFn: () => analyticsApi.getConversionFunnel(undefined, range.from, range.to),
  });
  const { data: visitorSeries } = useQuery({
    queryKey: ["bi-visitors-series", rangeKey],
    queryFn: () => analyticsApi.getVisitorSeries(undefined, range.from, range.to),
  });
  const { data: loggedInVsGuest } = useQuery({
    queryKey: ["bi-visitors-logged-in", rangeKey],
    queryFn: () => analyticsApi.getLoggedInVsGuest(undefined, range.from, range.to),
  });
  const { data: activeVisitors } = useQuery({ queryKey: ["bi-visitors-active"], queryFn: analyticsApi.getActiveVisitors, refetchInterval: 30_000 });

  const { data: engagement } = useQuery({
    queryKey: ["bi-visitors-engagement", rangeKey],
    queryFn: () => analyticsApi.getEngagementSummary(undefined, range.from, range.to),
  });
  const { data: entryExit } = useQuery({
    queryKey: ["bi-visitors-entry-exit", rangeKey],
    queryFn: () => analyticsApi.getEntryExitPages(undefined, 8, range.from, range.to),
  });
  const { data: geo } = useQuery({
    queryKey: ["bi-visitors-geo", rangeKey],
    queryFn: () => analyticsApi.getGeoBreakdown(undefined, 8, range.from, range.to),
  });
  const { data: devices } = useQuery({
    queryKey: ["bi-visitors-devices", rangeKey],
    queryFn: () => analyticsApi.getDeviceBreakdown(undefined, range.from, range.to),
  });
  const { data: browsers } = useQuery({
    queryKey: ["bi-visitors-browsers", rangeKey],
    queryFn: () => analyticsApi.getBrowserBreakdown(undefined, range.from, range.to),
  });
  const { data: os } = useQuery({
    queryKey: ["bi-visitors-os", rangeKey],
    queryFn: () => analyticsApi.getOsBreakdown(undefined, range.from, range.to),
  });
  const { data: languages } = useQuery({
    queryKey: ["bi-visitors-languages", rangeKey],
    queryFn: () => analyticsApi.getLanguageBreakdown(undefined, 8, range.from, range.to),
  });
  const { data: trafficSources } = useQuery({
    queryKey: ["bi-visitors-traffic-sources", rangeKey],
    queryFn: () => analyticsApi.getTrafficSources(undefined, 8, range.from, range.to),
  });

  const { data: frequency } = useQuery({ queryKey: ["bi-visitors-frequency"], queryFn: analyticsApi.getReturningVisitorFrequency });
  const { data: recentSessions } = useQuery({ queryKey: ["bi-visitors-recent-sessions"], queryFn: () => analyticsApi.getRecentSessions(20) });

  const totalPageViews = visitorSeries?.series.reduce((sum, p) => sum + p.pageViews, 0) ?? 0;

  function toBarItems<T extends { sessions: number }>(rows: T[] | undefined, label: (r: T) => string): RankedBarListItem[] {
    return (rows ?? []).map((r, i) => ({ key: `${label(r)}-${i}`, label: label(r), value: r.sessions, valueLabel: r.sessions.toLocaleString("en-BD") }));
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Visitor Analytics</h1>
        <p className="mt-1 text-sm text-ink-500">Who&apos;s coming to the site, where from, and what they do once they&apos;re here.</p>
      </div>

      {/* Visitors & sessions */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Visitors &amp; Sessions</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {!overview || !funnel || !loggedInVsGuest ? (
            Array.from({ length: 6 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Total Visitors" value={overview.totalVisitors.toLocaleString("en-BD")} icon={<Users size={18} />} tone="accent" />
              <ConversionMetricCard
                label="Returning Visitors"
                value={overview.returningVisitors.toLocaleString("en-BD")}
                caption="lifetime"
                icon={<Repeat size={18} />}
                pct={overview.returningVisitorRatePct}
              />
              <StatTile label="Sessions" value={funnel.totalSessions.toLocaleString("en-BD")} icon={<Radio size={18} />} />
              <StatTile label="Pages Viewed" value={totalPageViews.toLocaleString("en-BD")} icon={<FileText size={18} />} />
              <StatTile label="Logged In" value={loggedInVsGuest.loggedIn.toLocaleString("en-BD")} icon={<LogIn size={18} />} />
              <StatTile label="Guest" value={loggedInVsGuest.guest.toLocaleString("en-BD")} icon={<Users size={18} />} />
              <StatTile label="Live Right Now" value={(activeVisitors?.count ?? 0).toLocaleString("en-BD")} icon={<Radio size={18} />} tone="warning" />
              <ConversionMetricCard label="Bounce Rate" value={`${funnel.bounceRate.toFixed(1)}%`} icon={<Globe2 size={18} />} pct={funnel.bounceRate} />
            </>
          )}
        </div>
      </section>

      {/* Engagement */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Engagement</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
          {!engagement ? (
            Array.from({ length: 5 }).map((_, i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <StatTile label="Avg Session Duration" value={formatDuration(engagement.avgSessionDurationMs)} icon={<Radio size={18} />} />
              <StatTile label="Avg Time / Page" value={formatDuration(engagement.avgTimePerPageMs)} icon={<FileText size={18} />} />
              <StatTile label="Avg Pages / Session" value={engagement.avgPagesPerSession.toFixed(1)} icon={<FileText size={18} />} />
              <StatTile label="Avg Scroll Depth" value={`${engagement.avgScrollDepthPct.toFixed(0)}%`} icon={<Globe2 size={18} />} />
              <StatTile label="Avg Clicks / Page" value={engagement.avgClicksPerPage.toFixed(1)} icon={<Globe2 size={18} />} />
            </>
          )}
        </div>
      </section>

      {/* Entry & exit pages */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Landing pages</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList items={toBarItems(entryExit?.entryPages, (r) => r.path)} emptyLabel="No data yet for this range." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Exit pages</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList items={toBarItems(entryExit?.exitPages, (r) => r.path)} emptyLabel="No data yet for this range." />
          </CardContent>
        </Card>
      </section>

      {/* Geography */}
      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Geography</h2>
        <p className="mb-3 text-xs text-ink-400">
          From an offline IP-to-location lookup — country is reliable, but region/city accuracy is rough, especially for mobile-carrier
          IPs, which often resolve to the same city regardless of the visitor&apos;s actual location.
        </p>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Countries</CardTitle>
            </CardHeader>
            <CardContent>
              <RankedBarList
                items={(geo?.countries ?? []).map((r, i) => ({
                  key: `${r.countryCode}-${i}`,
                  label: countryName(r.countryCode),
                  value: r.sessions,
                  valueLabel: r.sessions.toLocaleString("en-BD"),
                }))}
                emptyLabel="No location data yet."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Regions</CardTitle>
            </CardHeader>
            <CardContent>
              <RankedBarList items={toBarItems(geo?.regions, (r) => r.region)} emptyLabel="No location data yet." />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cities</CardTitle>
            </CardHeader>
            <CardContent>
              <RankedBarList items={toBarItems(geo?.cities, (r) => r.city)} emptyLabel="No location data yet." />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Device / browser / OS / language / referral */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Devices</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={(devices?.devices ?? []).map((r, i) => ({ key: `${r.device}-${i}`, label: r.device, value: r.sessions, valueLabel: r.sessions.toLocaleString("en-BD") }))}
              emptyLabel="No data yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Browsers</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={(browsers?.browsers ?? []).map((r, i) => ({ key: `${r.browser}-${i}`, label: r.browser, value: r.sessions, valueLabel: r.sessions.toLocaleString("en-BD") }))}
              emptyLabel="No data yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Operating system</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList items={toBarItems(os?.os, (r) => r.os)} emptyLabel="No data yet." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Language</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList items={toBarItems(languages?.languages, (r) => r.language)} emptyLabel="No data yet." />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Referral sources</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList items={toBarItems(trafficSources?.sources, (r) => r.source)} emptyLabel="No data yet." />
          </CardContent>
        </Card>
      </section>

      {/* Returning visitor frequency */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Returning visitor frequency</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-xs text-ink-400">
              Distinct days each known visitor has been active on, lifetime — how sticky the audience is, not just how many show up once.
            </p>
            <RankedBarList
              items={(frequency?.buckets ?? []).map((b) => ({ key: b.bucket, label: b.bucket, value: b.visitors, valueLabel: b.visitors.toLocaleString("en-BD") }))}
              emptyLabel="No returning-visitor data yet."
            />
          </CardContent>
        </Card>
      </section>

      {/* Recent sessions — the visitor timeline */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Recent sessions</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!recentSessions || recentSessions.sessions.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-400">No sessions recorded yet.</p>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="pb-2 pr-4">Started</th>
                    <th className="pb-2 pr-4">Visitor</th>
                    <th className="pb-2 pr-4">Entry page</th>
                    <th className="pb-2 pr-4">Exit page</th>
                    <th className="pb-2 pr-4">Pages</th>
                    <th className="pb-2 pr-4">Duration</th>
                    <th className="pb-2">Device</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSessions.sessions.map((s) => (
                    <tr key={s.sessionId} className="border-b border-ink-50 last:border-0">
                      <td className="py-2 pr-4 text-ink-500">{timeAgo(s.startedAt)}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-ink-500">{s.visitorId ? s.visitorId.slice(0, 8) : "—"}</td>
                      <td className="max-w-[180px] truncate py-2 pr-4 text-ink-800">{s.entryPath}</td>
                      <td className="max-w-[180px] truncate py-2 pr-4 text-ink-800">{s.exitPath}</td>
                      <td className="py-2 pr-4 text-ink-800">{s.pageCount}</td>
                      <td className="py-2 pr-4 text-ink-800">{formatDuration(s.totalDurationMs)}</td>
                      <td className="py-2 text-ink-800">{s.device}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          Network/ISP isn&apos;t shown — the offline geo-IP lookup this store uses doesn&apos;t carry that data. A dedicated per-visitor
          drill-down (searching a single visitor&apos;s full history) isn&apos;t built yet either; the Recent Sessions table above covers
          the most recent activity in the meantime.
        </p>
      </Card>
    </div>
  );
}
