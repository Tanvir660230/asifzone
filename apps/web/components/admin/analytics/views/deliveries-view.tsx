"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/empty-state";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useBiDateRange } from "@/components/admin/bi-date-range-context";
import * as analyticsApi from "@/lib/api/admin-analytics";
import type { DeliveryOutcomes, OutcomeRow } from "@/lib/api/admin-analytics";
import { formatBusinessDate, formatCount, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const pct = (r: number) => `${Math.round(r * 100)}%`;
const days = (d: number | null) => (d === null ? "—" : `${d.toFixed(1)}d`);

/** A group's refusal rate stands out when it's well above the store's own (and the group isn't tiny). */
function isHot(row: OutcomeRow, overall: number, minParcels: number) {
  return row.parcels >= minParcels && row.refused > 0 && row.refusalRate >= Math.max(overall * 2, overall + 0.1);
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: React.ReactNode; tone?: "danger" }) {
  return (
    <Card className="p-3.5 sm:p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium text-fg-muted">
        {tone === "danger" && <span className="h-2 w-2 rounded-full bg-danger-500" aria-hidden />}
        {label}
      </p>
      <p className="pt-1 text-[22px] font-semibold leading-tight tracking-tight tabular-nums text-fg sm:text-[26px]">{value}</p>
      {note && <p className="mt-1 text-[12.5px] leading-snug text-fg-muted">{note}</p>}
    </Card>
  );
}

/** Change of a rate between two periods, in percentage points. `goodWhenUp` picks the colour. */
function PointsChange({ now, before, goodWhenUp }: { now: number; before: number | null; goodWhenUp: boolean }) {
  if (before === null) return <span>no earlier period to compare</span>;
  const pts = Math.round((now - before) * 100);
  if (Math.abs(pts) < 2) return <span>about the same as the period before</span>;
  const good = goodWhenUp ? pts > 0 : pts < 0;
  return (
    <span>
      <span className={cn("font-semibold", good ? "text-success-700" : "text-danger-600")}>
        {pts > 0 ? "+" : "−"}
        {Math.abs(pts)} pts
      </span>{" "}
      vs the period before
    </span>
  );
}

/** Success per week as bars, refusals stacked on top — the trend at a glance. */
function WeeklyBars({ weeks }: { weeks: DeliveryOutcomes["weekly"] }) {
  if (weeks.length === 0) return <p className="py-6 text-center text-sm text-fg-muted">No parcels finished in this period.</p>;
  const max = Math.max(...weeks.map((w) => w.parcels));
  return (
    <figure>
      <figcaption className="sr-only">
        Parcels finished per week: {weeks.map((w) => `week of ${formatBusinessDate(w.week)}, ${w.parcels} parcels, ${pct(w.successRate)} delivered`).join("; ")}
      </figcaption>
      <div aria-hidden className="flex h-36 items-end gap-1.5">
        {weeks.map((w) => (
          <div key={w.week} className="flex h-full flex-1 flex-col justify-end" title={`Week of ${formatBusinessDate(w.week)}: ${w.parcels} parcels · ${pct(w.successRate)} delivered · ${w.refused} refused`}>
            <div className="w-full rounded-t-[3px] bg-danger-400" style={{ height: `${(w.refused / max) * 100}%` }} />
            <div className="w-full bg-warning-200" style={{ height: `${(w.partial / max) * 100}%` }} />
            <div className="w-full rounded-b-[2px] bg-success-500" style={{ height: `${(w.delivered / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-1.5 flex gap-1.5 text-[11px] tabular-nums text-fg-muted">
        {weeks.map((w, i) => (
          <span key={w.week} className="flex-1 truncate text-center">
            {i % Math.ceil(weeks.length / 6) === 0 ? formatBusinessDate(w.week) : ""}
          </span>
        ))}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-success-500" aria-hidden /> Delivered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-warning-200" aria-hidden /> Part delivered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-danger-400" aria-hidden /> Refused / returned
        </span>
      </p>
    </figure>
  );
}

/** One breakdown as a table: parcels, refused %, days to deliver; unusually high refusal is flagged. Three numeric
 * columns so it fits a half-width card. */
function OutcomeTable({ title, rows, overall, minParcels, showDays = true, note }: { title: string; rows: OutcomeRow[]; overall: number; minParcels: number; showDays?: boolean; note?: string }) {
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
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell align="right">Parcels</TableHeaderCell>
                <TableHeaderCell align="right">Refused</TableHeaderCell>
                {showDays && <TableHeaderCell align="right">Days</TableHeaderCell>}
              </tr>
            </TableHead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={showDays ? 4 : 3} className="px-4 py-6 text-center text-sm text-fg-muted">
                    Not enough finished parcels yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const hot = isHot(r, overall, minParcels);
                  return (
                    <TableRow key={r.key}>
                      <TableCell className="min-w-[8rem] font-medium text-fg">
                        {r.key}
                      </TableCell>
                      <TableCell align="right">{formatCount(r.parcels)}</TableCell>
                      <TableCell align="right" className={cn(hot && "font-semibold text-danger-600")}>
                        {hot && <span className="sr-only">High: </span>}
                        {pct(r.refusalRate)}
                      </TableCell>
                      {showDays && <TableCell align="right">{days(r.avgDaysToDeliver)}</TableCell>}
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

/** A small "who refuses more" card: each group's refusal rate as a bar against the store's own rate. */
function RefusalBars({ title, rows, overall }: { title: string; rows: OutcomeRow[]; overall: number }) {
  const max = Math.max(overall, ...rows.map((r) => r.refusalRate), 0.01);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">No parcels finished in this period.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-fg">{r.key}</span>
                  <span className="shrink-0 tabular-nums text-fg-muted">
                    <span className={cn("font-semibold", r.refusalRate > overall * 1.5 && r.refused > 0 ? "text-danger-600" : "text-fg")}>{pct(r.refusalRate)}</span> refused ·{" "}
                    {formatCount(r.parcels)}
                  </span>
                </div>
                <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-900/[0.06]">
                  <div className="h-full rounded-full bg-danger-400" style={{ width: `${(r.refusalRate / max) * 100}%` }} />
                  <div className="absolute inset-y-0 w-[2px] bg-ink-900/50" style={{ left: `${(overall / max) * 100}%` }} title="Store average" />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12px] text-fg-muted">The dark tick is the store&apos;s average refusal rate ({pct(overall)}).</p>
      </CardContent>
    </Card>
  );
}

function RepeatRefusers({ list }: { list: DeliveryOutcomes["repeatRefusers"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Customers who refused twice or more</CardTitle>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">No customer refused more than one parcel in this period.</p>
        ) : (
          <TableContainer>
            <Table>
              <caption className="sr-only">Customers who refused two or more parcels</caption>
              <TableHead>
                <tr>
                  <TableHeaderCell>Customer</TableHeaderCell>
                  <TableHeaderCell align="right">Refused</TableHeaderCell>
                  <TableHeaderCell align="right">Delivered</TableHeaderCell>
                  <TableHeaderCell align="right">COD lost</TableHeaderCell>
                </tr>
              </TableHead>
              <tbody>
                {list.map((r) => (
                  <TableRow key={r.phone}>
                    <TableCell>
                      <Link href={`/admin/orders/${r.lastOrderId}`} className="font-medium text-fg hover:underline">
                        {r.name}
                      </Link>
                      <span className="block text-[12px] tabular-nums text-fg-muted">{r.phone}</span>
                    </TableCell>
                    <TableCell align="right" className="font-semibold text-danger-600">
                      {formatCount(r.refused)}
                    </TableCell>
                    <TableCell align="right">{formatCount(r.delivered)}</TableCell>
                    <TableCell align="right">{formatPrice(r.refusedCodValue)}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}

/** Delivery outcomes for the report period: how many parcels arrived, and where refusals cluster. */
export default function DeliveriesView() {
  const { range } = useBiDateRange();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["delivery-outcomes", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => analyticsApi.getDeliveryOutcomes(range.from, range.to),
  });

  if (isError) return <ErrorState description="Delivery figures didn't load." onRetry={() => void refetch()} />;
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
  const prev = data.previous && data.previous.parcels > 0 ? data.previous : null;
  const overall = t.refusalRate;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile
          label="Delivered in full"
          value={t.parcels ? pct(t.successRate) : "—"}
          note={t.parcels ? <PointsChange now={t.successRate} before={prev?.successRate ?? null} goodWhenUp /> : "No parcels finished yet"}
        />
        <Tile
          label="Refused / returned"
          value={formatCount(t.refused)}
          tone={t.refused > 0 ? "danger" : undefined}
          note={t.refused > 0 ? `${formatPrice(t.refusedCodValue)} of COD came back · ${pct(t.refusalRate)}` : "None in this period"}
        />
        <Tile label="Part delivered" value={formatCount(t.partial)} note={t.parcels ? `${pct(t.partial / t.parcels)} of parcels` : undefined} />
        <Tile label="Days to deliver" value={days(t.avgDaysToDeliver)} note={`From booking, over ${formatCount(t.delivered)} delivered parcels`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Week by week</CardTitle>
          </CardHeader>
          <CardContent>
            <WeeklyBars weeks={data.weekly} />
          </CardContent>
        </Card>
        <RefusalBars title="By order value" rows={data.byValue} overall={overall} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OutcomeTable
          title="By district"
          rows={data.byDistrict}
          overall={overall}
          minParcels={data.minParcels}
          note={`Districts with at least ${data.minParcels} finished parcels. Red = refused at least twice the store's rate.`}
        />
        <OutcomeTable title="By product" rows={data.byProduct} overall={overall} minParcels={data.minParcels} showDays={false} note="An order with several products counts for each." />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <RefusalBars title="By where the customer came from" rows={data.byChannel} overall={overall} />
        <RefusalBars title="New or returning customer" rows={data.byCustomer} overall={overall} />
        <RefusalBars title="By division" rows={data.byDivision} overall={overall} />
      </div>

      <RepeatRefusers list={data.repeatRefusers} />

      <p className="text-[12px] leading-relaxed text-fg-muted">
        A parcel counts in the period it finished: delivered, part delivered, or refused (the courier cancelled it after booking, or it
        came back). A delivered parcel the customer returns later stays a delivery.
      </p>
    </div>
  );
}
