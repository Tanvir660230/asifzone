"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/empty-state";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useBiDateRange } from "@/components/admin/bi-date-range-context";
import * as analyticsApi from "@/lib/api/admin-analytics";
import type { CancelBreakdownRow, Cancellations } from "@/lib/api/admin-analytics";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** A group's cancel rate stands out when it's well above the store's own (and the group isn't tiny). */
const isHot = (r: CancelBreakdownRow, overall: number, min: number) => r.orders >= min && r.cancelled > 0 && r.rate >= Math.max(overall * 1.5, overall + 0.1);

function Tile({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <Card className="p-3.5 sm:p-4">
      <p className="text-[13px] font-medium text-fg-muted">{label}</p>
      <p className="pt-1 text-[22px] font-semibold leading-tight tracking-tight tabular-nums text-fg sm:text-[26px]">{value}</p>
      {note && <p className="mt-1 text-[12.5px] leading-snug text-fg-muted">{note}</p>}
    </Card>
  );
}

/** Why: one bar per reason, longest first — the biggest leak is the first thing read. */
function Reasons({ data }: { data: Cancellations }) {
  const max = Math.max(1, ...data.reasons.map((r) => r.count));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Why they were cancelled</CardTitle>
      </CardHeader>
      <CardContent>
        {data.reasons.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">No cancellations before sending in this period.</p>
        ) : (
          <ul className="space-y-3" data-testid="cancel-reasons">
            {data.reasons.map((r) => (
              <li key={r.reason}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-fg">{r.label}</span>
                  <span className="tabular-nums text-fg-muted">
                    {formatCount(r.count)} <span className="text-[12px]">· {pct(r.share)}</span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-900/[0.05]" aria-hidden>
                  <div className={cn("h-full rounded-full", r.reason === "unspecified" ? "bg-ink-300" : "bg-ink-800")} style={{ width: `${(r.count / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {data.reasons.some((r) => r.reason === "unspecified") && (
          <p className="mt-4 text-[12px] leading-relaxed text-fg-muted">
            &ldquo;No reason written&rdquo; is a cancel with only &ldquo;Cancelled&rdquo; as its note. The cancel dialog now has one-tap reasons, so this
            shrinks from here on.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BreakdownTable({ title, rows, overall, min, nameHeader, note }: { title: string; rows: CancelBreakdownRow[]; overall: number; min: number; nameHeader: string; note?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <TableContainer className="max-h-[26rem] overflow-auto">
          <Table>
            <caption className="sr-only">{title}</caption>
            <TableHead className="sticky top-0 z-[1] bg-surface">
              <tr>
                <TableHeaderCell>{nameHeader}</TableHeaderCell>
                <TableHeaderCell align="right">Orders</TableHeaderCell>
                <TableHeaderCell align="right">Cancelled</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-sm text-fg-muted">
                    Not enough orders yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const hot = isHot(r, overall, min);
                  return (
                    <TableRow key={r.key}>
                      <TableCell className="min-w-[8rem] max-w-[16rem] break-words font-medium text-fg">{r.label}</TableCell>
                      <TableCell align="right">{formatCount(r.orders)}</TableCell>
                      <TableCell align="right" className={cn(hot && "font-semibold text-danger-600")}>
                        {hot && <span className="sr-only">High: </span>}
                        {formatCount(r.cancelled)} <span className="text-[12px] font-normal text-fg-muted">· {pct(r.rate)}</span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </tbody>
          </Table>
        </TableContainer>
        {note && <p className="mt-3 text-[12px] leading-relaxed text-fg-muted">{note}</p>}
      </CardContent>
    </Card>
  );
}

/** Orders cancelled before they were sent: how many, why, and which channel, page and product they came from. A parcel
 * refused at the door is a different problem, counted here and analysed under Deliveries. */
export default function CancellationsView() {
  const { range } = useBiDateRange();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["cancellations", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => analyticsApi.getCancellations(range.from, range.to),
  });

  if (isError) return <ErrorState description="Cancellation figures didn't load." onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-ink-900/[0.04]" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-xl bg-ink-900/[0.04]" />
      </div>
    );
  }

  const t = data.totals;
  const top = data.reasons.find((r) => r.reason !== "unspecified");
  return (
    <div className="space-y-6" data-testid="cancellations-view">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile label="Orders" value={formatCount(t.orders)} note="placed in this period" />
        <Tile label="Cancelled before sending" value={t.orders ? pct(t.cancelRate) : "—"} note={`${formatCount(t.cancelledBeforeSending)} orders`} />
        <Tile label="Top reason" value={top ? top.label : "—"} note={top ? `${pct(top.share)} of cancellations` : "No reason recorded yet"} />
        <Tile
          label="Refused at the door"
          value={formatCount(t.refusedAfterSending)}
          note={
            <>
              sent, then refused —{" "}
              <Link href="/admin/analytics/operations?view=deliveries" className="underline underline-offset-2">
                see Deliveries
              </Link>
            </>
          }
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Reasons data={data} />
        <BreakdownTable title="By channel" nameHeader="Channel" rows={data.byChannel} overall={t.cancelRate} min={data.minOrders} note="Where the visit that placed the order came from." />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable
          title="By landing page"
          nameHeader="First page"
          rows={data.byLanding}
          overall={t.cancelRate}
          min={data.minOrders}
          note={`The page the visit started on — an ad's landing page shows here. Pages with fewer than ${data.minOrders} orders are left out.`}
        />
        <BreakdownTable
          title="By product"
          nameHeader="Product"
          rows={data.byProduct}
          overall={t.cancelRate}
          min={data.minOrders}
          note={`Products with fewer than ${data.minOrders} orders are left out. Red: well above the store's own cancel rate.`}
        />
      </div>
    </div>
  );
}
