"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Receipt } from "lucide-react";
import { ListPage } from "@/components/admin/patterns/list-page";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapability } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as booksApi from "@/lib/api/finance-books";
import type { SpendingDay, SpendingKind, SpendingReport, SpendingRow } from "@/lib/api/finance-books";
import { formatPrice as formatExact } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<SpendingKind, string> = {
  GOODS: "Goods and materials",
  ADS: "Ads",
  DELIVERY: "Delivery",
  PACKAGING: "Packaging",
  FEES: "Payment fees",
  SALARIES: "Salaries",
  OTHER: "Other",
};
const MONTHS_SHOWN = 6;

/** Whole taka: this page answers "how much", the pages behind it show the paisa. */
const money = (v: number) => {
  const r = Math.round(v);
  return r < 0 ? `−${formatExact(-r)}` : formatExact(r);
};
const pad = (n: number) => String(n).padStart(2, "0");
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const shiftMonth = (key: string, by: number) => {
  const d = new Date(`${key}-01T00:00:00`);
  d.setMonth(d.getMonth() + by);
  return monthKey(d);
};
const monthEnd = (key: string) => {
  const d = new Date(`${shiftMonth(key, 1)}-01T00:00:00`);
  d.setDate(0);
  return `${key}-${pad(d.getDate())}`;
};
const monthName = (key: string, opts: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" }) => new Date(`${key}-01T00:00:00`).toLocaleDateString("en-GB", opts);
const dayName = (date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) => new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", opts);

/**
 * Spending (docs/FINANCE_SPENDING.md): how much was spent and when. The last months are bars you tap; the chosen one opens
 * to one total, what it went on, and every entry by day. Goods count on the day they were bought.
 */
export default function SpendingPage() {
  const canRecord = useCapability("finance.transact");
  const thisMonth = monthKey(new Date());
  const [month, setMonth] = useState(thisMonth);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [kind, setKind] = useState<SpendingKind | null>(null);

  const lastMonths = useMemo(() => Array.from({ length: MONTHS_SHOWN }, (_, i) => shiftMonth(thisMonth, i - MONTHS_SHOWN + 1)), [thisMonth]);
  const overviewRange = { from: `${lastMonths[0]}-01`, to: monthEnd(thisMonth) };
  const overview = useQuery({ queryKey: booksApi.spendingKey(overviewRange), queryFn: () => booksApi.getSpending(overviewRange) });
  // Months before the books started have nothing to show.
  const startedOn = overview.data?.booksStartedOn?.slice(0, 7);
  const months = startedOn && startedOn <= thisMonth ? lastMonths.filter((m) => m >= startedOn) : lastMonths;
  const customValid = custom ? Boolean(custom.from && custom.to && custom.from <= custom.to) : true;
  const range = custom && customValid ? custom : { from: `${month}-01`, to: monthEnd(month) };
  const q = useQuery({ queryKey: booksApi.spendingKey(range), queryFn: () => booksApi.getSpending(range), enabled: customValid });

  const monthTotals = useMemo(() => {
    const t = new Map<string, number>();
    for (const d of overview.data?.days ?? []) t.set(d.date.slice(0, 7), (t.get(d.date.slice(0, 7)) ?? 0) + d.total);
    return t;
  }, [overview.data]);

  const pickMonth = (m: string) => {
    setMonth(m);
    setCustom(null);
    setKind(null);
  };

  return (
    <ListPage
      title="Spending"
      description="Everything the store spent, by day. Goods count on the day you bought them."
      className="mx-auto max-w-3xl"
      tabs={false}
      action={
        canRecord ? (
          <Link href="/admin/finance/expenses?new=expense" className={buttonVariants({ className: "rounded-full" })}>
            <Plus className="h-4 w-4" aria-hidden /> Record expense
          </Link>
        ) : undefined
      }
    >
      <MonthBars months={months} totals={monthTotals} loading={overview.isLoading} selected={custom ? null : month} onPick={pickMonth} />

      <div className="mt-3">
        {custom ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field htmlFor="spending-from" label="From">
              <Input id="spending-from" type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </Field>
            <Field htmlFor="spending-to" label="To" error={customValid ? undefined : "The start is after the end."}>
              <Input id="spending-to" type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </Field>
            <Button variant="ghost" onClick={() => pickMonth(thisMonth)}>
              Back to months
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setCustom({ from: `${month}-01`, to: monthEnd(month) })} data-testid="spending-pick-dates">
            Choose dates
          </Button>
        )}
      </div>

      <div className="mt-5 space-y-6">
        {q.isError ? (
          <ErrorState description={getErrorMessage(q.error, "The spending didn't load.")} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-56 w-full rounded-3xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : (
          <>
            <Summary report={q.data} label={custom ? `${dayName(range.from, { day: "numeric", month: "short" })} to ${dayName(range.to, { day: "numeric", month: "short", year: "numeric" })}` : month === thisMonth ? `${monthName(month, { month: "long" })} so far` : monthName(month)} kind={kind} onKind={setKind} />
            {q.data.adsMissingAfter && (
              <Alert
                variant="warning"
                title={`Ads are recorded up to ${dayName(q.data.adsMissingAfter, { day: "numeric", month: "long" })}`}
              >
                Ads after that day are not in this total.
                <Link href="/admin/finance/ads" className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-3 flex w-fit`}>
                  Add ad spend
                </Link>
              </Alert>
            )}
            <Days report={q.data} kind={kind} onClear={() => setKind(null)} />
          </>
        )}
      </div>
    </ListPage>
  );
}

/** The last months as bars to tap: how much, and which one is open. */
function MonthBars({ months, totals, loading, selected, onPick }: { months: string[]; totals: Map<string, number>; loading: boolean; selected: string | null; onPick: (m: string) => void }) {
  const max = Math.max(1, ...months.map((m) => totals.get(m) ?? 0));
  return (
    <div role="group" aria-label="Month" className="grid auto-cols-fr grid-flow-col gap-1 sm:gap-2" data-testid="spending-months">
      {months.map((m) => {
        const v = totals.get(m) ?? 0;
        const on = selected === m;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={on}
            aria-label={`${monthName(m)}: ${money(v)}`}
            onClick={() => onPick(m)}
            className={cn("group flex min-w-0 flex-col items-center rounded-xl px-1 pb-2 pt-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus", on ? "bg-surface shadow-sm" : "hover:bg-ink-900/[0.03]")}
          >
            <span className="flex h-20 w-full items-end justify-center" aria-hidden="true">
              {loading ? <Skeleton className="h-10 w-7 rounded-md" /> : <span className={cn("w-7 rounded-md transition-colors sm:w-9", on ? "bg-ink-900" : "bg-ink-300 group-hover:bg-ink-400")} style={{ height: `${Math.max(3, (Math.max(0, v) / max) * 100)}%` }} />}
            </span>
            <span className={cn("mt-2 text-sm", on ? "font-semibold text-fg" : "text-fg-muted")}>{monthName(m, { month: "short" }).slice(0, 3)}</span>
            <span className="w-full truncate text-center text-xs tabular-nums text-fg-muted">{loading ? " " : short(v)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A bar's figure in little room: ৳8.1L (lakh), ৳14k. The button's label says it in full. */
function short(v: number) {
  if (v >= 100_000) return `${formatExact(0).replace(/[\d.,\s]/g, "")}${(v / 100_000).toFixed(1)}L`;
  if (v >= 1000) return `${formatExact(0).replace(/[\d.,\s]/g, "")}${Math.round(v / 1000)}k`;
  return money(v);
}

/** One total, then what it went on — each kind a bar you can tap to see only its entries. */
function Summary({ report, label, kind, onKind }: { report: SpendingReport; label: string; kind: SpendingKind | null; onKind: (k: SpendingKind | null) => void }) {
  const kinds = report.kinds.filter((k) => Math.round(k.total) !== 0).sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...kinds.map((k) => k.total));
  return (
    <section className="liquid-pass p-5 sm:p-6" aria-label={`${label}: spent`} data-testid="spending-summary">
      <p className="text-base text-fg-muted">{label}, you spent</p>
      <p className="mt-1 text-figure-md font-semibold leading-none tracking-[-0.03em] tabular-nums text-fg sm:text-figure-lg" data-testid="spending-total">
        {money(report.total)}
      </p>
      {kinds.length > 0 && (
        <ul className="mt-5 space-y-1" aria-label="What it went on">
          {kinds.map((k) => {
            const on = kind === k.kind;
            return (
              <li key={k.kind}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onKind(on ? null : k.kind)}
                  className={cn("-mx-2 grid min-h-11 w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus", on ? "bg-ink-900/[0.06]" : "hover:bg-ink-900/[0.03]", kind && !on && "opacity-60")}
                  data-testid={`spending-kind-${k.kind}`}
                >
                  <span className={cn("truncate text-sm", on ? "font-semibold text-fg" : "text-fg")}>{KIND_LABEL[k.kind]}</span>
                  <span className="text-sm font-medium tabular-nums text-fg">{money(k.total)}</span>
                  <span className="col-span-2 mt-1 h-1.5 overflow-hidden rounded-full bg-ink-900/[0.06]" aria-hidden="true">
                    <span className="block h-full rounded-full bg-ink-700" style={{ width: `${Math.max(1, (Math.max(0, k.total) / max) * 100)}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Days({ report, kind, onClear }: { report: SpendingReport; kind: SpendingKind | null; onClear: () => void }) {
  const days: SpendingDay[] = useMemo(() => {
    if (!kind) return report.days;
    return report.days
      .map((d) => {
        const rows = d.rows.filter((r) => r.kind === kind);
        return { ...d, rows, total: rows.reduce((s, r) => s + r.amount, 0) };
      })
      .filter((d) => d.rows.length > 0);
  }, [report.days, kind]);

  if (!report.days.length) return <EmptyState icon={Receipt} title="Nothing spent in this period" description="Purchases, ads, delivery and expenses appear here on the day they happen." />;
  return (
    <section aria-label="By day">
      <div className="mb-2 flex min-h-9 items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-fg">{kind ? KIND_LABEL[kind] : "Day by day"}</h2>
        {kind && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Show everything
          </Button>
        )}
      </div>
      <div className="space-y-4">
        {days.map((d) => (
          <section key={d.date} className="rounded-2xl bg-surface shadow-sm ring-1 ring-inset ring-line-subtle" data-testid="spending-day">
            <header className="flex items-baseline justify-between gap-3 px-4 pb-1 pt-3 sm:px-5">
              <h3 className="text-sm font-semibold text-fg">{dayName(d.date)}</h3>
              <span className="text-sm font-semibold tabular-nums text-fg">{money(d.total)}</span>
            </header>
            <ul className="divide-y divide-line-subtle">
              {d.rows.map((r, i) => (
                <Row key={`${r.kind}-${i}`} row={r} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

function Row({ row }: { row: SpendingRow }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm text-fg">{row.title}</span>
        {row.detail && <span className="block text-xs text-fg-muted">{row.detail}</span>}
      </span>
      <span className="shrink-0 text-sm tabular-nums text-fg">{money(row.amount)}</span>
    </>
  );
  // A purchase opens to its items; anything else goes to the page behind it.
  if (row.lines && row.lines.length > 1) {
    return (
      <li>
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus sm:px-5 [&::-webkit-details-marker]:hidden">
            {body}
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-300 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="space-y-1 px-4 pb-3 text-sm sm:px-5">
            {row.lines.map((l) => (
              <li key={l.name} className="flex justify-between gap-3 text-fg-muted">
                <span className="min-w-0 break-words">
                  {l.name}, <span className="whitespace-nowrap tabular-nums">{l.quantity.toLocaleString("en-US")} {l.unit ?? "pcs"}</span>
                </span>
                <span className="shrink-0 tabular-nums">{money(l.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      </li>
    );
  }
  return (
    <li>
      {row.href ? (
        <Link href={row.href} className="flex min-h-12 items-center gap-3 px-4 py-2 outline-none hover:bg-ink-900/[0.02] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus sm:px-5">
          {body}
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" aria-hidden />
        </Link>
      ) : (
        <div className="flex min-h-12 items-center gap-3 px-4 py-2 sm:px-5">{body}</div>
      )}
    </li>
  );
}
