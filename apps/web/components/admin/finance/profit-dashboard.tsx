"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Megaphone } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { getErrorMessage } from "@/lib/api-client";
import * as booksApi from "@/lib/api/finance-books";
import type { ProfitTotals } from "@/lib/api/finance-books";
import { formatBookDate, formatPrice } from "@/lib/format";
import { addDays, bucketDays, daysBetween, defaultGrain, PRESET_LABEL, PROFIT_PRESETS, priorLabel, type Grain, type ProfitPreset } from "@/lib/profit-period";
import { cn } from "@/lib/utils";
import { METRIC_LABEL, money, ProfitChart, type ProfitMetric } from "./profit-chart";

export interface ProfitPeriod { preset: ProfitPreset; from: string; to: string; grain: Grain | "" }

/**
 * The Profit dashboard (docs/FINANCE_PROFIT_DASHBOARD.md): for any period — today, the last 7 / 30 days, a month, three
 * months or a custom range — what the business kept, the sales and ad spend behind it, a chart by day / week / month and
 * where every taka of sales went. Read from profit by day, which adds up to the books' net profit.
 */
export function ProfitDashboard({ period, onChange }: { period: ProfitPeriod; onChange: (patch: Partial<ProfitPeriod>) => void }) {
  const { from, to, preset } = period;
  const bad = from > to;
  const tooLong = !bad && daysBetween(from, to) > 366;
  const q = useQuery({ queryKey: booksApi.booksKeys.profitDaily({ from, to }), queryFn: () => booksApi.getProfitByDay({ from, to }), enabled: !bad && !tooLong, placeholderData: (prev) => prev });
  // A day or two alone makes a poor chart: show the two weeks around it, with the chosen days lit.
  const short = daysBetween(from, to) < 7;
  const chartRange = short ? { from: addDays(to, -13), to } : { from, to };
  const chartQ = useQuery({ queryKey: booksApi.booksKeys.profitDaily(chartRange), queryFn: () => booksApi.getProfitByDay(chartRange), enabled: short && !bad, placeholderData: (prev) => prev });
  const campaigns = useQuery({ queryKey: booksApi.booksKeys.campaigns({ from, to }), queryFn: () => booksApi.listCampaigns({ from, to }), enabled: !bad && !tooLong });

  const d = q.data;
  const days = daysBetween(from, to);
  const compareWith = priorLabel(preset, days);
  // Compare only when the whole period before is inside the books — a part-empty one would read as "up from nothing".
  const comparable = Boolean(d && d.booksStartedOn && d.prior.from >= d.booksStartedOn);

  return (
    <div className="space-y-6" data-testid="profit-dashboard">
      <PeriodBar period={period} onChange={onChange} bad={bad} tooLong={tooLong} />

      {q.isError && <Alert variant="danger" title="Profit couldn't be worked out" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "Try again in a moment.")}</Alert>}
      {!d && !q.isError && !bad && !tooLong && <DashboardSkeleton />}

      {d && (
        <div className={cn("space-y-6 transition-opacity duration-fast", q.isPlaceholderData && "opacity-60")} aria-busy={q.isFetching}>
          {!d.booksStartedOn && (
            <Alert variant="info" title="The books haven't started yet">
              Profit appears here once the books are started — <Link href="/admin/finance/opening" className="text-accent hover:underline">start the books</Link>.
            </Alert>
          )}
          {d.booksStartedOn && from < d.booksStartedOn && (
            <p className="text-sm text-fg-muted">The books start on {formatBookDate(d.booksStartedOn)} — days before that show nothing here (see the estimate further down).</p>
          )}
          {d.totals.sales > 0 && d.totals.goods === 0 && (
            <Alert variant="warning" title="The cost of the goods isn't known yet">
              Profit here is too high until each product has its cost — confirm your stock&apos;s value in <Link href="/admin/finance/inventory-cutover" className="text-accent hover:underline">Valuation cutover</Link>.
            </Alert>
          )}

          <Hero totals={d.totals} prior={comparable ? d.priorTotals : null} compareWith={compareWith} label={periodName(period, d.today)} />

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key numbers">
            <Kpi label="Sales" value={d.totals.sales} prior={comparable ? d.priorTotals.sales : null} good="up" note={`${d.totals.orders} delivered order${d.totals.orders === 1 ? "" : "s"}`} href="/admin/finance/sales" />
            <Kpi label="Ad spend" value={d.totals.ads} prior={comparable ? d.priorTotals.ads : null} good="down" note={d.totals.salesPerAdTaka === null ? "No ads in this period" : `${formatPrice(1)} of ads → ${formatPrice(d.totals.salesPerAdTaka)} sales`} href="/admin/finance/ads" />
            <Kpi label="Goods & packaging" value={d.totals.goods + d.totals.packaging} prior={comparable ? d.priorTotals.goods + d.priorTotals.packaging : null} good="down" note={share(d.totals.goods + d.totals.packaging, d.totals.sales)} href="/admin/finance/inventory-cutover" />
            <Kpi label="Delivery & fees" value={d.totals.delivery + d.totals.paymentFees} prior={comparable ? d.priorTotals.delivery + d.priorTotals.paymentFees : null} good="down" note={share(d.totals.delivery + d.totals.paymentFees, d.totals.sales)} href="/admin/finance/courier" />
          </section>

          <ChartCard data={short ? chartQ.data?.days ?? null : d.days} period={period} onChange={onChange} highlight={short ? { from, to } : undefined} />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <WhereItWent totals={d.totals} />
            <AdsCard q={campaigns} totals={d.totals} />
          </div>
        </div>
      )}
    </div>
  );
}

function periodName(p: ProfitPeriod, today: string): string {
  if (p.preset === "today") return "Today so far";
  if (p.preset === "custom") return p.from === p.to ? formatBookDate(p.from) : `${formatBookDate(p.from)} – ${formatBookDate(p.to)}`;
  if (p.preset === "month") return `${new Date(`${today.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })} so far`;
  if (p.preset === "lastMonth") return new Date(`${p.from}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return p.preset === "yesterday" ? "Yesterday" : `Last ${PRESET_LABEL[p.preset]}`;
}

const share = (part: number, of: number) => (of > 0 ? `${Math.round((part / of) * 100)}% of sales` : "—");

// ── the period ────────────────────────────────────────────────────────────────────────────────────────────────────────

function PeriodBar({ period, onChange, bad, tooLong }: { period: ProfitPeriod; onChange: (patch: Partial<ProfitPeriod>) => void; bad: boolean; tooLong: boolean }) {
  // On a phone the row scrolls sideways: keep the chosen period in view (e.g. "3 months" opened from a link).
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    const active = el?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (!el || !active) return;
    const a = active.getBoundingClientRect(), s = el.getBoundingClientRect();
    el.scrollTo({ left: el.scrollLeft + a.left - s.left - (s.width - a.width) / 2 });
  }, [period.preset]);
  return (
    <div className="space-y-3">
      {/* One row that scrolls sideways on a phone instead of wrapping into a block of buttons. */}
      <div ref={strip} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <SegmentedControl
          aria-label="Period"
          value={period.preset}
          onChange={(preset) => onChange({ preset })}
          options={PROFIT_PRESETS.map((p) => ({ value: p, label: PRESET_LABEL[p] }))}
        />
      </div>
      {period.preset === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          <Field htmlFor="pd-from" label="From" className="w-40"><Input id="pd-from" type="date" value={period.from} max={period.to} onChange={(e) => e.target.value && onChange({ from: e.target.value })} /></Field>
          <Field htmlFor="pd-to" label="To" className="w-40" error={bad ? "Before From" : tooLong ? "At most a year" : undefined}><Input id="pd-to" type="date" value={period.to} min={period.from} onChange={(e) => e.target.value && onChange({ to: e.target.value })} /></Field>
        </div>
      )}
    </div>
  );
}

// ── the headline ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Hero({ totals, prior, compareWith, label }: { totals: ProfitTotals; prior: ProfitTotals | null; compareWith: string; label: string }) {
  const loss = totals.profit < 0;
  const diff = prior ? Math.round(totals.profit - prior.profit) : null;
  return (
    <Card className="p-5 sm:p-7" data-testid="profit-hero">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className={cn("mt-1 text-[2rem] font-semibold leading-tight tracking-tight tabular-nums sm:text-[2.75rem]", loss ? "text-danger-600" : "text-fg")}>
        {loss ? `${money(-totals.profit)} loss` : `${money(totals.profit)} profit`}
      </p>
      <p className="mt-1 text-[15px] text-fg-muted">
        from <span className="font-medium tabular-nums text-fg">{money(totals.sales)}</span> in sales
        {totals.marginPct !== null && totals.sales > 0 && <> · you keep <span className="font-medium tabular-nums text-fg">{money(Math.max(0, totals.marginPct))}</span> of every {formatPrice(100)}</>}
      </p>
      {Math.round(totals.stockCorrections) !== 0 && (
        <p className="mt-2 text-sm text-fg-muted" data-testid="profit-corrections">
          Includes stock corrections of <span className="font-medium tabular-nums text-fg">{money(-totals.stockCorrections)}</span> (count fixes, cost corrections) — from selling alone,{" "}
          <span className={cn("font-medium tabular-nums", totals.salesProfit < 0 ? "text-danger-600" : "text-fg")}>{totals.salesProfit < 0 ? `${money(-totals.salesProfit)} loss` : `${money(totals.salesProfit)} profit`}</span>.
        </p>
      )}
      {diff !== null && diff !== 0 && <Delta className="mt-3" diff={diff} good="up" text={`${diff > 0 ? "more" : "less"} than ${compareWith}`} />}
      {diff === 0 && <p className="mt-3 text-sm text-fg-muted">The same as {compareWith}.</p>}
    </Card>
  );
}

function Delta({ diff, good, text, className }: { diff: number; good: "up" | "down"; text: string; className?: string }) {
  const better = good === "up" ? diff > 0 : diff < 0;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cn("flex items-center gap-1 text-sm", className)}>
      <span className={cn("inline-flex items-center gap-0.5 font-semibold tabular-nums", better ? "text-success-700" : "text-danger-600")}>
        <Icon className="h-4 w-4" aria-hidden />
        {money(Math.abs(diff))}
      </span>
      <span className="text-fg-muted">{text}</span>
    </p>
  );
}

function Kpi({ label, value, prior, good, note, href }: { label: string; value: number; prior: number | null; good: "up" | "down"; note: string; href: string }) {
  const diff = prior === null ? 0 : Math.round(value - prior);
  const better = good === "up" ? diff > 0 : diff < 0;
  return (
    <Link href={href} className="group block" aria-label={`${label}: ${money(value)}`}>
      <Card className="flex h-full flex-col p-3.5 transition-colors duration-fast group-hover:border-line-strong sm:p-5">
        <p className="flex items-center justify-between gap-2 text-[13px] font-medium text-fg-muted">
          {label}
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-accent max-sm:hidden" aria-hidden />
        </p>
        <p className="pt-1 text-[20px] font-semibold leading-tight tracking-tight tabular-nums text-fg sm:pt-2 sm:text-[26px]">{money(value)}</p>
        <p className="mt-1 text-xs text-fg-muted">{note}</p>
        {prior !== null && diff !== 0 && (
          <p className={cn("mt-auto flex items-center gap-0.5 pt-2 text-xs font-semibold tabular-nums", better ? "text-success-700" : "text-danger-600")}>
            {diff > 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
            {money(Math.abs(diff))}<span className="font-normal text-fg-muted">&nbsp;vs before</span>
          </p>
        )}
      </Card>
    </Link>
  );
}

// ── the chart ────────────────────────────────────────────────────────────────────────────────────────────────────────

function ChartCard({ data, period, onChange, highlight }: { data: booksApi.ProfitDay[] | null; period: ProfitPeriod; onChange: (patch: Partial<ProfitPeriod>) => void; highlight?: { from: string; to: string } }) {
  const [metric, setMetric] = useState<ProfitMetric>("profit");
  const span = data ? data.length : 0;
  const grain: Grain = highlight ? "day" : period.grain || defaultGrain(span);
  const buckets = useMemo(() => (data ? bucketDays(data, grain) : []), [data, grain]);
  const lit = highlight ? buckets.find((b) => b.from >= highlight.from && b.to <= highlight.to)?.key : undefined;
  return (
    <Card className="p-4 sm:p-6" data-testid="profit-chart">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-fg">{METRIC_LABEL[metric]} by {grain}</h2>
          <p className="text-xs text-fg-muted">{highlight ? "The last two weeks, the chosen day lit. " : ""}A sale counts on the day its parcel is delivered; ads on the day they ran.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!highlight && span > 14 && (
            <SegmentedControl aria-label="Group by" value={grain} onChange={(g) => onChange({ grain: g })} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, ...(span > 60 ? [{ value: "month" as const, label: "Month" }] : [])]} />
          )}
          <SegmentedControl aria-label="Show" value={metric} onChange={setMetric} options={(["profit", "sales", "ads", "orders"] as const).map((m) => ({ value: m, label: m === "ads" ? "Ads" : METRIC_LABEL[m] }))} />
        </div>
      </div>
      {data ? <ProfitChart buckets={buckets} grain={grain} metric={metric} highlight={lit} /> : <Skeleton className="h-[220px] w-full" />}
    </Card>
  );
}

// ── where the money went ─────────────────────────────────────────────────────────────────────────────────────────────

const PARTS: Array<{ key: "goods" | "packaging" | "delivery" | "paymentFees" | "ads" | "running"; label: string; hint: string; color: string; href: string }> = [
  { key: "goods", label: "Goods", hint: "what the items sold cost you", color: "bg-ink-700", href: "/admin/finance/inventory-cutover" },
  { key: "packaging", label: "Packaging", hint: "bags, boxes, labels", color: "bg-ink-600", href: "/admin/finance/packaging" },
  { key: "delivery", label: "Delivery", hint: "courier charges", color: "bg-ink-500", href: "/admin/finance/courier" },
  { key: "paymentFees", label: "Payment fees", hint: "bKash, Nagad and card fees", color: "bg-ink-400", href: "/admin/finance/settlements" },
  { key: "ads", label: "Ads", hint: "Facebook & Instagram", color: "bg-ink-300", href: "/admin/finance/ads" },
  { key: "running", label: "Running costs", hint: "rent, salaries, hosting, other", color: "bg-ink-200", href: "/admin/finance/expenses" },
];

function WhereItWent({ totals }: { totals: ProfitTotals }) {
  const base = totals.sales > 0 ? totals.sales : 0;
  const per100 = (v: number) => (base ? (Math.max(0, v) / base) * 100 : 0);
  const loss = totals.profit < 0;
  return (
    <Card className="p-5 sm:p-6" data-testid="profit-breakdown">
      <h2 className="text-[17px] font-semibold tracking-tight text-fg">Where every {formatPrice(100)} of sales went</h2>
      {base > 0 ? (
        <>
          <div className="mt-4 flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
            {PARTS.map((p) => per100(totals[p.key]) > 0 && <span key={p.key} className={p.color} style={{ width: `${per100(totals[p.key])}%` }} />)}
            {!loss && totals.profit > 0 && <span className="bg-success-500" style={{ width: `${per100(totals.profit)}%` }} />}
          </div>
          <ul className="mt-3 divide-y divide-line-subtle">
            {PARTS.map((p) => (
              <li key={p.key}>
                <Link href={p.href} className="group flex items-center gap-3 py-2.5 text-sm">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", p.color)} aria-hidden="true" />
                  <span className="min-w-0 flex-1"><span className="block text-fg group-hover:text-accent">{p.label}</span><span className="hidden text-xs text-fg-muted sm:block">{p.hint}</span></span>
                  <span className="w-12 text-right tabular-nums text-fg-muted">{formatPrice(Math.round(per100(totals[p.key])))}</span>
                  <span className="w-24 text-right tabular-nums text-fg">{money(totals[p.key])}</span>
                </Link>
              </li>
            ))}
            {Math.round(totals.stockCorrections) !== 0 && (
              <li className="flex items-center gap-3 py-2.5 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-ink-400" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-fg">Stock corrections</span><span className="hidden text-xs text-fg-muted sm:block">count fixes and cost corrections, not sales</span></span>
                <span className="w-12" />
                <span className="w-24 text-right tabular-nums text-fg">{money(totals.stockCorrections)}</span>
              </li>
            )}
            <li className="flex items-center gap-3 py-2.5 text-sm font-medium">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", loss ? "bg-danger-500" : "bg-success-500")} aria-hidden="true" />
              <span className="flex-1 text-fg">{loss ? "Lost" : "You keep"}</span>
              <span className={cn("w-12 text-right tabular-nums", loss ? "text-danger-600" : "text-success-700")}>{loss ? `−${formatPrice(Math.round(-totals.profit / base * 100))}` : formatPrice(Math.round(per100(totals.profit)))}</span>
              <span className={cn("w-24 text-right tabular-nums", loss ? "text-danger-600" : "text-success-700")}>{money(totals.profit)}</span>
            </li>
          </ul>
        </>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">No delivered sales in this period{totals.ads + totals.running > 0 ? ` — costs so far ${money(totals.goods + totals.packaging + totals.delivery + totals.paymentFees + totals.ads + totals.running)}` : ""}. Sales count as parcels are delivered.</p>
      )}
    </Card>
  );
}

// ── ads ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

function AdsCard({ q, totals }: { q: UseQueryResult<Awaited<ReturnType<typeof booksApi.listCampaigns>>>; totals: ProfitTotals }) {
  const list = (q.data?.campaigns ?? []).filter((c) => c.spend > 0).sort((a, b) => b.spend - a.spend);
  return (
    <Card className="flex flex-col p-5 sm:p-6" data-testid="profit-ads">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-fg">Ads</h2>
          <p className="text-sm text-fg-muted">
            {money(totals.ads)} spent{totals.salesPerAdTaka !== null && <> · each {formatPrice(1)} brought <span className="font-medium tabular-nums text-fg">{formatPrice(totals.salesPerAdTaka)}</span> of delivered sales</>}
          </p>
        </div>
        <Megaphone className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
      </div>
      {totals.ads > 0 && (
        <dl className="mt-4 grid grid-cols-3 gap-3 border-y border-line-subtle py-3 text-center">
          <AdStat label="Per delivered order" value={totals.orders ? money(totals.ads / totals.orders) : "—"} />
          <AdStat label="Of sales" value={totals.sales > 0 ? `${Math.round((totals.ads / totals.sales) * 1000) / 10}%` : "—"} />
          <AdStat label={`Sales per ${formatPrice(1)}`} value={totals.salesPerAdTaka === null ? "—" : formatPrice(totals.salesPerAdTaka)} />
        </dl>
      )}
      {q.isLoading && <Skeleton className="mt-4 h-32 w-full" />}
      {q.isError && <p className="mt-4 text-sm text-danger-600">Campaigns couldn&apos;t load. <button type="button" className="text-accent hover:underline" onClick={() => q.refetch()}>Retry</button></p>}
      {q.data && list.length === 0 && (
        <p className="mt-4 text-sm text-fg-muted">No campaign spend recorded for these days. <Link href="/admin/finance/ads" className="text-accent hover:underline">Add a campaign or connect Meta</Link> to see each one here.</p>
      )}
      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-line-subtle">
          {list.slice(0, 5).map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg">{c.name}</span>
                <span className="block text-xs text-fg-muted">{c.orders} order{c.orders === 1 ? "" : "s"} from its visitors{c.costPerOrder !== null && ` · ${money(c.costPerOrder)} each`}</span>
              </span>
              <span className="w-24 text-right tabular-nums text-fg">{money(c.spend)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/admin/finance/ads" className="mt-auto flex items-center gap-1 pt-3 text-sm font-medium text-accent hover:underline">All campaigns<ChevronRight className="h-4 w-4" aria-hidden /></Link>
    </Card>
  );
}

function AdStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="mt-0.5 text-xs text-fg-muted">{label}</dt>
      <dd className="text-[17px] font-semibold tabular-nums tracking-tight text-fg">{value}</dd>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-36 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      <Skeleton className="h-80 w-full rounded-2xl" />
    </div>
  );
}
