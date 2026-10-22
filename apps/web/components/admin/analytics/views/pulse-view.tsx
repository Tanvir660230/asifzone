"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, ArrowUpRight } from "lucide-react";
import { addDays } from "@clothing-brand/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import { ErrorState } from "@/components/ui/empty-state";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow, TableSkeleton } from "@/components/ui/table";
import { ChartFrame } from "@/components/admin/chart-frame";
import { AnomalyStrip, BriefCard } from "./brief-card";
import * as analyticsApi from "@/lib/api/admin-analytics";
import type { OpsCountKey, OpsCounts, OpsDailyRow, OpsPulse } from "@/lib/api/admin-analytics";
import { formatBusinessDate, formatCount, formatPrice, formatStoreTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The pulse tiles, in the order work flows through the shop. `lowerIsBetter` flips the colour of a change. */
const TILES: Array<{ key: OpsCountKey; label: string; hint: string; lowerIsBetter?: boolean; ordersHref?: (date: string) => string }> = [
  { key: "placed", label: "Orders in", hint: "Orders placed (website, landing pages and phone)", ordersHref: (d) => `/admin/orders?from=${d}&to=${d}` },
  { key: "confirmed", label: "Confirmed", hint: "Orders that moved forward from pending for the first time" },
  { key: "booked", label: "Sent to courier", hint: "Parcels booked with the courier" },
  { key: "delivered", label: "Delivered", hint: "Parcels delivered in full" },
  { key: "partially_delivered", label: "Part delivered", hint: "The customer kept only part of the parcel", lowerIsBetter: true },
  { key: "returned", label: "Refused / returned", hint: "Parcels the courier brought back — refused at the door, or returned", lowerIsBetter: true },
  { key: "cancelled", label: "Cancelled", hint: "Orders cancelled before they were sent to the courier", lowerIsBetter: true },
];

/** Delivered in full ÷ every parcel that reached an end with the courier that day (delivered, part delivered, refused). */
function deliveryRate(c: OpsCounts): number | null {
  const ended = c.delivered + c.partially_delivered + c.returned;
  return ended === 0 ? null : c.delivered / ended;
}
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** The eighth tile: delivery success, compared in percentage points (a rate's % change would read oddly). */
function DeliveryRateTile({ pulse }: { pulse: OpsPulse }) {
  const rate = deliveryRate(pulse.day);
  const usual = deliveryRate(pulse.typical);
  const diff = rate !== null && usual !== null ? Math.round((rate - usual) * 100) : null;
  return (
    <Card className="flex h-full flex-col gap-1.5 p-3.5 sm:p-4">
      <p className="text-[13px] font-medium leading-snug text-fg-muted" title="Delivered in full ÷ parcels delivered, part delivered or refused that day">
        Delivery success
      </p>
      <p className="text-[24px] font-semibold leading-tight tracking-tight tabular-nums text-fg sm:text-[28px]">{pct(rate)}</p>
      <p className="text-[12.5px] leading-snug">
        {diff === null ? (
          <span className="text-fg-muted">{rate === null ? "no parcels finished" : "no usual to compare"}</span>
        ) : Math.abs(diff) < 3 ? (
          <span className="text-fg-muted">about a usual {weekdayShort(pulse.date)}</span>
        ) : (
          <span className={cn("font-semibold", diff > 0 ? "text-success-700" : "text-danger-600")}>
            {diff > 0 ? "+" : "−"}
            {Math.abs(diff)} pts <span className="font-normal text-fg-muted">vs a usual {weekdayShort(pulse.date)}</span>
          </span>
        )}
      </p>
      <Comparisons date={pulse.date} yesterday={pct(deliveryRate(pulse.yesterday))} lastWeek={pct(deliveryRate(pulse.lastWeek))} usual={pct(usual)} />
    </Card>
  );
}

const fmtAvg = (n: number) => (Number.isInteger(n) ? formatCount(n) : n.toFixed(1));
const weekday = (date: string) => formatBusinessDate(date, { weekday: "long" });
const weekdayShort = (date: string) => formatBusinessDate(date, { weekday: "short" });

/** % change of `value` against `base`; null when there's no base to compare with. */
function changePct(value: number, base: number): number | null {
  if (base === 0) return null;
  return ((value - base) / base) * 100;
}

function ChangeNote({ value, base, lowerIsBetter, against }: { value: number; base: number; lowerIsBetter?: boolean; against: string }) {
  const pct = changePct(value, base);
  if (pct === null) return <span className="text-fg-muted">{value > 0 ? `none ${against}` : `same as ${against}`}</span>;
  // Under one order apart (0 vs a usual 0.3) or within 10% isn't a change worth colouring.
  if (Math.abs(pct) < 10 || Math.abs(value - base) < 1) return <span className="text-fg-muted">about {against}</span>;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return (
    <span className={cn("font-semibold", good ? "text-success-700" : "text-danger-600")}>
      {pct > 0 ? "+" : "−"}
      {Math.abs(pct).toFixed(0)}% <span className="font-normal text-fg-muted">vs {against}</span>
    </span>
  );
}

/** Yesterday / same weekday last week / usual — three columns, or three label-value rows on a phone where three
 * labels side by side would run into each other. */
function Comparisons({ date, yesterday, lastWeek, usual }: { date: string; yesterday: string; lastWeek: string; usual: string }) {
  const items: Array<[string, string]> = [
    ["Yesterday", yesterday],
    [`Last ${weekdayShort(date)}`, lastWeek],
    ["Usual", usual],
  ];
  return (
    <dl className="mt-auto grid grid-cols-1 gap-0.5 border-t border-line pt-2 text-[12px] tabular-nums sm:grid-cols-3 sm:gap-1">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-2 sm:block">
          <dt className="whitespace-nowrap text-fg-muted">{label}</dt>
          <dd className="font-medium text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PulseTile({ pulse, tile }: { pulse: OpsPulse; tile: (typeof TILES)[number] }) {
  const { key, label, hint, lowerIsBetter, ordersHref } = tile;
  const value = pulse.day[key];
  const body = (
    <Card className={cn("flex h-full flex-col gap-1.5 p-3.5 sm:p-4", ordersHref && "transition-colors duration-fast hover:border-line-strong")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium leading-snug text-fg-muted" title={hint}>
          {label}
        </p>
        {ordersHref && <ArrowUpRight size={14} className="shrink-0 text-ink-400" aria-hidden />}
      </div>
      <p className="text-[24px] font-semibold leading-tight tracking-tight tabular-nums text-fg sm:text-[28px]">{formatCount(value)}</p>
      {key === "booked" && pulse.day.booked_cod_value > 0 && (
        <p className="text-[12.5px] tabular-nums text-fg-muted">{formatPrice(pulse.day.booked_cod_value)} to collect</p>
      )}
      <p className="text-[12.5px] leading-snug">
        <ChangeNote value={value} base={pulse.typical[key]} lowerIsBetter={lowerIsBetter} against={`a usual ${weekdayShort(pulse.date)}`} />
      </p>
      <Comparisons date={pulse.date} yesterday={formatCount(pulse.yesterday[key])} lastWeek={formatCount(pulse.lastWeek[key])} usual={fmtAvg(pulse.typical[key])} />
    </Card>
  );
  if (!ordersHref) return body;
  return (
    <Link href={ordersHref(pulse.date)} aria-label={`${label}: ${value} — open these orders`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {body}
    </Link>
  );
}

function hourLabel(h: number): string {
  const suffix = h < 12 ? "am" : "pm";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${suffix}`;
}

/** Orders per hour: the day as bars, the usual for that weekday as a tick on each bar. */
function HourlyChart({ pulse }: { pulse: OpsPulse }) {
  const max = Math.max(1, ...pulse.hourly.map((h) => Math.max(h.day, h.typical)));
  const busiest = pulse.hourly.reduce((top, h) => (h.day > top.day ? h : top), pulse.hourly[0]!);
  const summary =
    busiest.day > 0
      ? `Busiest hour ${hourLabel(busiest.hour)} with ${busiest.day} orders. The usual ${weekday(pulse.date)} peaks at ${hourLabel(pulse.hourly.reduce((t, h) => (h.typical > t.typical ? h : t), pulse.hourly[0]!).hour)}.`
      : "No orders yet on this day.";
  const table = {
    caption: "Orders per hour",
    columns: [{ label: "Hour" }, { label: "Orders", align: "right" as const }, { label: `Usual ${weekdayShort(pulse.date)}`, align: "right" as const }],
    rows: pulse.hourly.map((h) => ({ key: String(h.hour), cells: [hourLabel(h.hour), formatCount(h.day), fmtAvg(h.typical)] })),
  };
  return (
    <ChartFrame summary={summary} table={table}>
      <div aria-hidden className="flex h-40 items-end gap-[3px]">
        {pulse.hourly.map((h) => (
          <div key={h.hour} className="group relative flex h-full flex-1 flex-col justify-end" title={`${hourLabel(h.hour)}: ${h.day} orders · usual ${fmtAvg(h.typical)}`}>
            <div className="w-full rounded-t-[3px] bg-accent/80 transition-colors duration-fast group-hover:bg-accent" style={{ height: `${(h.day / max) * 100}%` }} />
            {h.typical > 0 && <div className="absolute inset-x-0 h-[2px] rounded-full bg-ink-900/45" style={{ bottom: `${(h.typical / max) * 100}%` }} />}
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-1.5 flex justify-between text-[11px] tabular-nums text-fg-muted">
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>
      <p className="mt-2 flex items-center gap-4 text-[12px] text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent/80" aria-hidden /> This day
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-3 rounded-full bg-ink-900/45" aria-hidden /> Usual {weekday(pulse.date)}
        </span>
      </p>
    </ChartFrame>
  );
}

/** A labelled share bar: one row per part of a whole. */
function ShareRows({ rows, total, emptyLabel }: { rows: Array<{ key: string; label: string; value: number; tone: string; href?: string }>; total: number; emptyLabel: string }) {
  if (total === 0) return <p className="py-6 text-center text-sm text-fg-muted">{emptyLabel}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const pct = (r.value / total) * 100;
        const label = (
          <span className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-fg">{r.label}</span>
            <span className="tabular-nums text-fg-muted">
              <span className="font-semibold text-fg">{formatCount(r.value)}</span> · {pct.toFixed(0)}%
            </span>
          </span>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} className="block rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                {label}
              </Link>
            ) : (
              label
            )}
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-900/[0.06]">
              <div className={cn("h-full rounded-full", r.tone)} style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The work waiting right now — each row opens the matching orders. */
function QueueList({ queues }: { queues: OpsPulse["queues"] }) {
  const rows: Array<{ key: string; label: string; value: number; note?: string; href: string; urgent?: boolean }> = [
    { key: "await", label: "Waiting to be confirmed", value: queues.awaitingConfirmation, href: "/admin/orders?f.status=PENDING" },
    { key: "due", label: "Call-backs due now", value: queues.holdsDue, href: "/admin/orders?f.queue=followUpDue", urgent: true },
    { key: "hold", label: "On hold (call back later)", value: queues.onHold, href: "/admin/orders?f.status=PENDING" },
    { key: "book", label: "Confirmed, not sent to courier", value: queues.readyToBook, href: "/admin/orders?f.status=CONFIRMED,PROCESSING,PACKED&f.courier=false" },
    {
      key: "courier",
      label: "With the courier",
      value: queues.withCourier,
      note: queues.withCourierCod > 0 ? `${formatPrice(queues.withCourierCod)} to collect` : undefined,
      href: "/admin/orders?f.status=CONFIRMED,PROCESSING,PACKED,SHIPPED&f.courier=true",
    },
    { key: "stuck", label: "With the courier over 5 days", value: queues.stuckWithCourier, href: "/admin/orders?f.status=CONFIRMED,PROCESSING,PACKED,SHIPPED&f.courier=true&sort=createdAt", urgent: true },
    { key: "partial", label: "Part deliveries to reconcile", value: queues.partialToReconcile, href: "/admin/orders?f.status=PARTIALLY_DELIVERED", urgent: true },
  ];
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.key}>
          <Link href={r.href} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px] transition-colors duration-fast hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <span className="flex min-w-0 items-center gap-2">
              {r.urgent && r.value > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-warning-500" aria-hidden />}
              <span>
                {r.label}
                {r.note && <span className="block text-[12px] text-fg-muted">{r.note}</span>}
              </span>
            </span>
            <span className={cn("tabular-nums font-semibold", r.value === 0 ? "text-fg-muted" : "text-fg")}>{formatCount(r.value)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Order status changes each staff member made that day — the work done, busiest first. */
function StaffList({ pulse }: { pulse: OpsPulse }) {
  if (pulse.staff.length === 0) return <p className="py-6 text-center text-sm text-fg-muted">No one changed an order on this day.</p>;
  const top = pulse.staff[0]!.total;
  return (
    <ul className="space-y-3">
      {pulse.staff.map((s) => {
        const parts = [
          s.confirmed && `${formatCount(s.confirmed)} confirmed`,
          s.cancelled && `${formatCount(s.cancelled)} cancelled`,
          s.packed && `${formatCount(s.packed)} packed`,
          s.shipped + s.other > 0 && `${formatCount(s.shipped + s.other)} other`,
        ].filter(Boolean);
        return (
          <li key={s.adminId}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate font-medium text-fg">{s.name}</span>
              <span className="shrink-0 tabular-nums font-semibold text-fg">{formatCount(s.total)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-900/[0.06]">
              <div className="h-full rounded-full bg-ink-500" style={{ width: `${(s.total / top) * 100}%` }} />
            </div>
            <p className="mt-1 text-[12px] text-fg-muted">{parts.join(" · ")}</p>
          </li>
        );
      })}
    </ul>
  );
}

const DAILY_COLUMNS: Array<{ key: keyof OpsDailyRow; label: string; money?: boolean }> = [
  { key: "placed", label: "Orders" },
  { key: "confirmed", label: "Confirmed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "booked", label: "To courier" },
  { key: "booked_cod_value", label: "COD booked", money: true },
  { key: "delivered", label: "Delivered" },
  { key: "partially_delivered", label: "Part delivered" },
  { key: "returned", label: "Refused / returned" },
  { key: "realised_net_sales", label: "Net sales", money: true },
  { key: "payments_received", label: "Cash in", money: true },
];

type DailySpan = 7 | 14 | 30 | 90;

function downloadCsv(rows: OpsDailyRow[], from: string, to: string) {
  const header = ["Date", ...DAILY_COLUMNS.map((c) => c.label), "Website", "Landing page", "Phone", "Shipped"];
  const lines = rows.map((r) => [r.date, ...DAILY_COLUMNS.map((c) => String(r[c.key])), r.placed_web, r.placed_landing, r.placed_phone, r.shipped].join(","));
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `daily-operations-${from}-to-${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Every day in the span ending on `to`, newest first — the whole operation at a glance, with totals. */
function DailyTable({ to }: { to: string }) {
  const [span, setSpan] = useState<DailySpan>(14);
  const from = addDays(to, -(span - 1));
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["ops-daily", from, to], queryFn: () => analyticsApi.getOpsDaily(from, to) });
  const rows = useMemo(() => [...(data?.days ?? [])].reverse(), [data]);
  const best = useMemo(() => Math.max(0, ...rows.map((r) => r.placed)), [rows]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Day by day</CardTitle>
        <div className="flex items-center gap-2">
          <SegmentedControl<DailySpan>
            aria-label="Days to show"
            value={span}
            onChange={setSpan}
            options={[7, 14, 30, 90].map((n) => ({ value: n as DailySpan, label: `${n}D` }))}
          />
          <Button variant="outline" size="sm" disabled={!data} onClick={() => data && downloadCsv(data.days, from, to)} aria-label="Download as CSV">
            <Download size={14} aria-hidden />
            <span className="max-sm:hidden">CSV</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isError ? (
          <ErrorState variant="plain" description="The day-by-day table didn't load." onRetry={() => void refetch()} />
        ) : (
          <TableContainer className="max-h-[32rem] overflow-auto">
            <Table>
              <caption className="sr-only">
                Operations per day, {formatBusinessDate(from)} to {formatBusinessDate(to)}
              </caption>
              <TableHead className="sticky top-0 z-[1] bg-surface">
                <tr>
                  <TableHeaderCell className="sticky left-0 bg-surface">Day</TableHeaderCell>
                  {DAILY_COLUMNS.map((c) => (
                    <TableHeaderCell key={c.key} align="right" className="whitespace-nowrap">
                      {c.label}
                    </TableHeaderCell>
                  ))}
                </tr>
              </TableHead>
              <tbody>
                {isLoading || !data ? (
                  <TableSkeleton rows={6} cols={DAILY_COLUMNS.length + 1} />
                ) : (
                  <>
                    {rows.map((r) => (
                      <TableRow key={r.date}>
                        <TableCell className="sticky left-0 whitespace-nowrap bg-surface font-medium text-fg">
                          <Link href={`/admin/orders?from=${r.date}&to=${r.date}`} className="hover:underline">
                            {formatBusinessDate(r.date, { weekday: "short", month: "short", day: "numeric" })}
                          </Link>
                        </TableCell>
                        {DAILY_COLUMNS.map((c) => (
                          <TableCell
                            key={c.key}
                            align="right"
                            className={cn("whitespace-nowrap", r[c.key] === 0 && "text-fg-muted", c.key === "placed" && r.placed === best && best > 0 && "font-semibold text-success-700")}
                          >
                            {c.money ? formatPrice(r[c.key] as number) : formatCount(r[c.key] as number)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-line-strong">
                      <TableCell className="sticky left-0 bg-surface font-semibold text-fg">Total</TableCell>
                      {DAILY_COLUMNS.map((c) => (
                        <TableCell key={c.key} align="right" className="whitespace-nowrap font-semibold text-fg">
                          {c.money ? formatPrice(data.totals[c.key] as number) : formatCount(data.totals[c.key] as number)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </>
                )}
              </tbody>
            </Table>
          </TableContainer>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-fg-muted">
          Each order counts once per step, on the day it first got there. Net sales and cash in come from the sales figures (delivered COD
          and paid online orders, less refunds).
        </p>
      </CardContent>
    </Card>
  );
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function PulseSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-64 animate-pulse rounded-md bg-ink-900/[0.06]" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl bg-ink-900/[0.04]" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-ink-900/[0.04]" />
    </div>
  );
}

/** Daily pulse: one business day's operations — orders in, confirmed, sent to courier, delivered, returned — against
 * yesterday, the same weekday last week and the usual for that weekday; the work waiting now; and a day-by-day table. */
export default function PulseView() {
  // null = today (the server decides what "today" is, in the store's timezone).
  const [date, setDate] = useState<string | null>(null);
  const { data: pulse, isLoading, isError, isPlaceholderData, refetch } = useQuery({
    queryKey: ["ops-pulse", date],
    queryFn: () => analyticsApi.getOpsPulse(date ?? undefined),
    refetchInterval: date === null ? 60_000 : false,
    // Stepping to another day keeps the current one on screen (dimmed) instead of blanking the page.
    placeholderData: keepPreviousData,
  });
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    if (pulse?.partialDay) setToday(pulse.date);
  }, [pulse]);
  const isToday = pulse ? pulse.partialDay : date === null;

  if (isError) return <ErrorState description="The daily pulse didn't load." onRetry={() => void refetch()} />;
  if (isLoading || !pulse) return <PulseSkeleton />;

  const go = (d: string) => setDate(today && d >= today ? null : d);
  const sourceRows = [
    { key: "web", label: "Website", value: pulse.day.placed_web, tone: "bg-accent" },
    { key: "landing", label: "Landing pages", value: pulse.day.placed_landing, tone: "bg-accent/60" },
    { key: "phone", label: "Phone orders", value: pulse.day.placed_phone, tone: "bg-ink-500" },
    { key: "other", label: "Other", value: pulse.day.placed - pulse.day.placed_web - pulse.day.placed_landing - pulse.day.placed_phone, tone: "bg-ink-300" },
  ].filter((r) => r.value > 0 || r.key !== "other");
  const c = pulse.cohort;
  const cohortRows = [
    { key: "delivered", label: "Delivered", value: c.delivered, tone: "bg-success-500" },
    { key: "courier", label: "With the courier", value: c.withCourier, tone: "bg-accent" },
    { key: "confirmed", label: "Confirmed, not sent yet", value: c.confirmed, tone: "bg-accent/50" },
    { key: "waiting", label: "Waiting to be confirmed", value: c.waiting, tone: "bg-warning-500" },
    { key: "hold", label: "On hold", value: c.onHold, tone: "bg-warning-200" },
    { key: "returned", label: "Refused / returned", value: c.returned, tone: "bg-danger-400" },
    { key: "cancelled", label: "Cancelled", value: c.cancelled, tone: "bg-danger-600" },
  ].filter((r) => r.value > 0);

  return (
    <div className={cn("space-y-6 transition-opacity duration-fast", isPlaceholderData && "opacity-60")} aria-busy={isPlaceholderData || undefined}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            {isToday ? "Today" : formatBusinessDate(pulse.date, { weekday: "long" })}
            <span className="font-normal text-fg-muted"> · {formatBusinessDate(pulse.date, { weekday: isToday ? "long" : undefined, month: "long", day: "numeric", year: "numeric" })}</span>
          </h2>
          <p className="mt-1 text-[13px] text-fg-muted">
            {pulse.partialDay && pulse.asOf
              ? `So far, as of ${formatStoreTime(pulse.asOf)}. Other days are counted up to the same time, so the comparison is fair.`
              : `Compared with the day before, last ${weekday(pulse.date)} and a usual ${weekday(pulse.date)} (average of the last 4).`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => go(addDays(pulse.date, -1))} aria-label="Previous day">
            <ChevronLeft size={16} aria-hidden />
          </Button>
          <Input
            type="date"
            aria-label="Pick a day"
            className="h-8 w-[9.5rem] text-[13px]"
            value={pulse.date}
            max={today ?? undefined}
            onChange={(e) => e.target.value && go(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={() => go(addDays(pulse.date, 1))} disabled={isToday} aria-label="Next day">
            <ChevronRight size={16} aria-hidden />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={() => setDate(null)}>
              Today
            </Button>
          )}
        </div>
      </div>

      <AnomalyStrip date={pulse.date} isToday={isToday} />
      <BriefCard date={pulse.date} isToday={isToday} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {TILES.map((t) => (
          <PulseTile key={t.key} pulse={pulse} tile={t} />
        ))}
        <DeliveryRateTile pulse={pulse} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section title="Orders by hour" className="lg:col-span-2">
          <HourlyChart pulse={pulse} />
        </Section>
        <Section title="Where orders came from">
          <ShareRows rows={sourceRows} total={pulse.day.placed} emptyLabel="No orders on this day." />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section title={isToday ? "Where today's orders stand" : "Where that day's orders stand now"}>
          <ShareRows rows={cohortRows} total={c.placed} emptyLabel="No orders were placed on this day." />
        </Section>
        <Section title="Waiting right now">
          <QueueList queues={pulse.queues} />
        </Section>
        <Section title="Staff on this day">
          <StaffList pulse={pulse} />
        </Section>
      </div>

      <DailyTable to={pulse.date} />
    </div>
  );
}

