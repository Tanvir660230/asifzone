"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/empty-state";
import { useBiDateRange } from "@/components/admin/bi-date-range-context";
import * as analyticsApi from "@/lib/api/admin-analytics";
import type { Mover, WhyChanged } from "@/lib/api/admin-analytics";
import { formatBusinessDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const count = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v).toLocaleString("en-US") : v.toFixed(1));
const signed = (v: number, fmt: (x: number) => string) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v))}`;
/** Whole taka: paisa in a "why did it change" story is noise. */
const taka = (v: number) => formatPrice(Math.round(v));
const span = (r: { from: string; to: string }) => `${formatBusinessDate(r.from)} – ${formatBusinessDate(r.to)}`;

/** Before → each factor's effect → after, as signed bars on one scale: a bridge you read top to bottom. */
function Bridge({ rows, before, after, fmt }: { rows: Array<{ label: string; value: number }>; before: number; after: number; fmt: (v: number) => string }) {
  const max = Math.max(Math.abs(before), Math.abs(after), ...rows.map((r) => Math.abs(r.value)), 1e-9);
  const bar = (v: number, tone: string) => (
    <div className="relative h-2 flex-1 rounded-full bg-ink-900/[0.05]">
      <div className={cn("absolute inset-y-0 rounded-full", tone, v < 0 ? "right-1/2" : "left-1/2")} style={{ width: `${(Math.abs(v) / max) * 50}%` }} />
      <div className="absolute inset-y-[-3px] left-1/2 w-px bg-ink-900/25" />
    </div>
  );
  const line = (label: string, value: string, b: React.ReactNode, strong = false) => (
    <li key={label} className="flex items-center gap-3 text-[13px]">
      <span className={cn("w-40 shrink-0 max-sm:w-28", strong ? "font-semibold text-fg" : "text-fg-muted")}>{label}</span>
      {b}
      <span className={cn("w-24 shrink-0 text-right tabular-nums max-sm:w-20", strong ? "font-semibold text-fg" : "text-fg")}>{value}</span>
    </li>
  );
  return (
    <ul className="space-y-2.5" aria-hidden="true">
      {line("Last period", fmt(before), bar(before, "bg-ink-400"), true)}
      {rows.map((r) => line(r.label, signed(r.value, fmt), bar(r.value, r.value >= 0 ? "bg-success-500" : "bg-danger-400")))}
      {line("This period", fmt(after), bar(after, "bg-accent"), true)}
    </ul>
  );
}

/** One plain sentence: which factor moved the number most. */
function explain(total: number, parts: Array<{ up: string; down: string; value: number }>, fmt: (v: number) => string): string {
  if (Math.abs(total) < 1e-9 && parts.every((p) => Math.abs(p.value) < 1e-9)) return "No change from the period before.";
  const words = parts
    .filter((p) => Math.abs(p.value) >= Math.abs(total) * 0.05 || Math.abs(p.value) >= 0.5)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .map((p) => `${signed(p.value, fmt)} ${p.value >= 0 ? p.up : p.down}`);
  return `${signed(total, fmt)} in all: ${words.join(", ")}.`;
}

function Movers({ title, data, money = true }: { title: string; data: { up: Mover[]; down: Mover[] }; money?: boolean }) {
  const fmt = (v: number) => (money ? taka(v) : count(v));
  const list = (items: Mover[], up: boolean) =>
    items.length === 0 ? (
      <p className="py-2 text-[13px] text-fg-muted">{up ? "Nothing grew." : "Nothing fell."}</p>
    ) : (
      <ul className="divide-y divide-line">
        {items.map((m) => (
          <li key={m.key} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
            <span className="min-w-0 truncate text-fg" title={m.key}>
              {m.key}
            </span>
            <span className={cn("shrink-0 font-semibold tabular-nums", up ? "text-success-700" : "text-danger-600")}>
              {signed(m.change, (x) => fmt(x))}
              <span className="sr-only"> ({fmt(m.before)} to {fmt(m.after)})</span>
            </span>
          </li>
        ))}
      </ul>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-fg-muted">Up</p>
          {list(data.up, true)}
        </div>
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-fg-muted">Down</p>
          {list(data.down, false)}
        </div>
      </CardContent>
    </Card>
  );
}

function Body({ d }: { d: WhyChanged }) {
  const o = d.webOrders;
  const s = d.netSales;
  const orderSentence = explain(o.total, [
    { up: "from more visitors", down: "from fewer visitors", value: o.effects.visits },
    { up: "from better conversion", down: "from worse conversion", value: o.effects.conversion },
  ], count);
  const salesSentence = explain(s.total, [
    { up: "from more delivered orders", down: "from fewer delivered orders", value: s.effects.orders },
    { up: "from bigger orders", down: "from smaller orders", value: s.effects.orderValue },
  ], taka);
  const conv = (p: WhyChanged["numbers"]["before"]) => (p.sessions ? `${((p.webOrders / p.sessions) * 100).toFixed(2)}%` : "—");
  const aov = (p: WhyChanged["numbers"]["before"]) => (p.realisedOrders ? taka(p.netSales / p.realisedOrders) : "—");

  return (
    <div className="space-y-6">
      <p className="text-[13px] text-fg-muted">
        {span(d.range)} compared with {span(d.previous)}, the same number of days just before it.
      </p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Website orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[14px] leading-relaxed text-fg">{orderSentence}</p>
            <Bridge
              before={o.before}
              after={o.after}
              fmt={count}
              rows={[
                { label: "Visitors", value: o.effects.visits },
                { label: "Conversion", value: o.effects.conversion },
              ]}
            />
            <p className="text-[12px] leading-relaxed text-fg-muted">
              Visits {count(d.numbers.before.sessions)} → {count(d.numbers.after.sessions)} · conversion {conv(d.numbers.before)} → {conv(d.numbers.after)}. Phone and
              admin orders ({count(d.otherOrders.before)} → {count(d.otherOrders.after)}) aren&apos;t part of this split.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Net sales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[14px] leading-relaxed text-fg">{salesSentence}</p>
            <Bridge
              before={s.before}
              after={s.after}
              fmt={taka}
              rows={[
                { label: "Delivered orders", value: s.effects.orders },
                { label: "Order value", value: s.effects.orderValue },
              ]}
            />
            <p className="text-[12px] leading-relaxed text-fg-muted">
              Delivered / paid orders {count(d.numbers.before.realisedOrders)} → {count(d.numbers.after.realisedOrders)} · average order {aov(d.numbers.before)} →{" "}
              {aov(d.numbers.after)}.
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Movers title="Products" data={d.movers.products} />
        <Movers title="Districts" data={d.movers.districts} />
        <Movers title="Channels" data={d.movers.channels} />
      </div>
      <p className="text-[12px] leading-relaxed text-fg-muted">
        The split is exact: each part is that factor&apos;s share of the change (log-mean method), and the parts add up to the whole. Products are
        merchandise sales less returns; districts and channels are net sales.
      </p>
    </div>
  );
}

/** Why sales went up or down against the period before: visitors vs conversion, orders vs order value, and the movers. */
export default function WhyView() {
  const { range } = useBiDateRange();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["why-changed", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => analyticsApi.getWhyChanged(range.from, range.to),
  });
  if (isError) return <ErrorState description="The comparison didn't load." onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" aria-busy="true" aria-label="Loading">
        <div className="h-72 animate-pulse rounded-xl bg-ink-900/[0.04]" />
        <div className="h-72 animate-pulse rounded-xl bg-ink-900/[0.04]" />
      </div>
    );
  }
  return <Body d={data} />;
}
