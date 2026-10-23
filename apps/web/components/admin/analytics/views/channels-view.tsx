"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/empty-state";
import { useBiDateRange } from "@/components/admin/bi-date-range-context";
import * as analyticsApi from "@/lib/api/admin-analytics";
import type { ChannelPerformanceRow } from "@/lib/api/admin-analytics";
import { formatCount, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const pct = (r: number | null, digits = 1) => (r === null ? "—" : `${(r * 100).toFixed(digits)}%`);

function Summary({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="p-3.5 sm:p-4">
      <p className="text-[13px] font-medium text-fg-muted">{label}</p>
      <p className="pt-1 text-[22px] font-semibold leading-tight tracking-tight tabular-nums text-fg sm:text-[26px]">{value}</p>
      {note && <p className="mt-1 text-[12.5px] leading-snug text-fg-muted">{note}</p>}
    </Card>
  );
}

/** One channel: its share of net sales as a bar, and the funnel numbers under it. */
function ChannelRow({ row, maxSales, best }: { row: ChannelPerformanceRow; maxSales: number; best: boolean }) {
  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[14px] font-medium text-fg">{row.label}</span>
          {row.paid && <Badge variant="info">Paid</Badge>}
          {best && <Badge variant="success">Best conversion</Badge>}
        </span>
        <span className="shrink-0 text-[14px] font-semibold tabular-nums text-fg">{formatPrice(row.netSales)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-900/[0.06]">
        <div className={cn("h-full rounded-full", row.paid ? "bg-accent" : row.channel === null ? "bg-ink-400" : "bg-accent/60")} style={{ width: `${maxSales > 0 ? (row.netSales / maxSales) * 100 : 0}%` }} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] tabular-nums sm:grid-cols-4">
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-fg-muted">Visits</dt>
          <dd className="font-medium text-fg">{row.channel === null ? "—" : formatCount(row.sessions)}</dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-fg-muted">Orders</dt>
          <dd className="font-medium text-fg">{formatCount(row.orders)}</dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-fg-muted">Conversion</dt>
          <dd className="font-medium text-fg">{pct(row.conversionRate)}</dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-fg-muted">Avg order</dt>
          <dd className="font-medium text-fg">{row.realisedOrders ? formatPrice(row.aov) : "—"}</dd>
        </div>
      </dl>
    </li>
  );
}

/** Which channels bring visitors, and which of them actually sell — for the shared report period. */
export default function ChannelsView() {
  const { range } = useBiDateRange();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["channel-performance", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => analyticsApi.getChannelPerformance(range.from, range.to),
  });

  if (isError) return <ErrorState description="Channel figures didn't load." onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-ink-900/[0.04]" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-ink-900/[0.04]" />
      </div>
    );
  }

  const { channels, totals } = data;
  const web = channels.filter((c) => c.channel !== null);
  const webOrders = web.reduce((s, c) => s + c.orders, 0);
  // "Best" is among the channels that bring people in (direct visitors already know the shop), and needs enough visits
  // to mean something — 1 order from 3 visits isn't a finding.
  const candidates = web.filter((c) => c.channel !== "direct" && c.sessions >= 100 && c.orders >= 3);
  const best = candidates.reduce<ChannelPerformanceRow | null>((b, c) => (!b || (c.conversionRate ?? 0) > (b.conversionRate ?? 0) ? c : b), null);
  const maxSales = Math.max(0, ...channels.map((c) => c.netSales));
  // Channels that brought visits but no sales get one compact line instead of a full row each.
  const selling = channels.filter((c) => c.orders > 0 || c.netSales > 0);
  const visitOnly = channels.filter((c) => c.orders === 0 && c.netSales === 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Summary label="Website visits" value={formatCount(totals.sessions)} />
        <Summary label="Orders from the website" value={formatCount(webOrders)} note={`${pct(totals.sessions ? webOrders / totals.sessions : null, 2)} of visits ordered`} />
        <Summary label="Net sales" value={formatPrice(totals.netSales)} note="Delivered COD and paid online, less refunds" />
        <Summary label="Best converting" value={best ? best.label : "—"} note={best ? `${pct(best.conversionRate)} of visits ordered` : "Not enough visits yet"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sales by channel</CardTitle>
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <p className="py-8 text-center text-sm text-fg-muted">No visits or orders in this period.</p>
          ) : (
            <ul className="divide-y divide-line">
              {selling.map((row) => (
                <ChannelRow key={row.key} row={row} maxSales={maxSales} best={row.key === best?.key} />
              ))}
            </ul>
          )}
          {visitOnly.length > 0 && (
            <p className="mt-4 text-[12.5px] leading-relaxed text-fg-muted">
              <span className="font-medium text-fg">Visits, no orders yet:</span>{" "}
              {visitOnly.map((c) => `${c.label} ${formatCount(c.sessions)}`).join(" · ")}
            </p>
          )}
          <p className="mt-4 border-t border-line pt-3 text-[12px] leading-relaxed text-fg-muted">
            A visit counts for the channel it came from (Facebook&apos;s many links and app all count as Facebook; &quot;Paid&quot; means
            an ad click). An order counts for the last channel that brought the customer: someone who clicked an ad and came back
            &quot;direct&quot; within {data.lookbackDays} days to order is credited to the ad
            {totals.reattributedFromDirect > 0 ? ` — ${formatCount(totals.reattributedFromDirect)} orders this period` : ""}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
