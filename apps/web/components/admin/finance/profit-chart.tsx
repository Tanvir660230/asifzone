"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChartFrame, type ChartTableData } from "@/components/admin/chart-frame";
import { formatBusinessDate, formatPrice, storeCurrencySymbol } from "@/lib/format";
import type { Grain, ProfitBucket } from "@/lib/profit-period";
import { cn } from "@/lib/utils";

export type ProfitMetric = "profit" | "sales" | "ads" | "orders";
export const METRIC_LABEL: Record<ProfitMetric, string> = { profit: "Profit", sales: "Sales", ads: "Ad spend", orders: "Orders" };

/** Drawn at the width it is shown at (measured), so labels stay 10.5px on a phone instead of shrinking with a fixed viewBox. */
const DEFAULT_WIDTH = 760;
const HEIGHT = 260;
const PAD = { top: 14, right: 8, bottom: 28, left: 52 };
const INNER_H = HEIGHT - PAD.top - PAD.bottom;

/** Whole taka, a real minus sign, and never "−৳0" (a negated zero cost). */
export const money = (v: number) => {
  const r = Math.round(v) || 0;
  return r < 0 ? `−${formatPrice(-r)}` : formatPrice(r);
};
function compact(v: number, metric: ProfitMetric): string {
  if (metric === "orders") return String(Math.round(v));
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  const s = storeCurrencySymbol();
  if (a >= 100_000) return `${sign}${s}${(a / 100_000).toFixed(1).replace(/\.0$/, "")}L`;
  if (a >= 1000) return `${sign}${s}${(a / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${sign}${s}${Math.round(a)}`;
}
const valueOf = (b: ProfitBucket, metric: ProfitMetric) => b[metric];
const format = (v: number, metric: ProfitMetric) => (metric === "orders" ? String(v) : money(v));

/** "Oct 4", "Oct 4 – 10", "October" — a bucket's name. */
export function bucketLabel(b: ProfitBucket, grain: Grain, long = false): string {
  if (grain === "month") return formatBusinessDate(b.from, { month: long ? "long" : "short", year: long ? "numeric" : undefined });
  if (grain === "week" && b.from !== b.to) {
    const sameMonth = b.from.slice(0, 7) === b.to.slice(0, 7);
    return `${formatBusinessDate(b.from)} – ${sameMonth ? Number(b.to.slice(8)) : formatBusinessDate(b.to)}`;
  }
  return formatBusinessDate(b.from, long ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
}

/** A bar whose data end (away from the zero line) is rounded and whose base sits square on the baseline. */
function barPath(x: number, w: number, yValue: number, yZero: number): string {
  const up = yValue <= yZero;
  const h = Math.abs(yZero - yValue);
  if (h < 0.5) return "";
  const r = Math.min(4, w / 2, h);
  if (up) return `M${x},${yZero} V${yValue + r} Q${x},${yValue} ${x + r},${yValue} H${x + w - r} Q${x + w},${yValue} ${x + w},${yValue + r} V${yZero} Z`;
  return `M${x},${yZero} V${yValue - r} Q${x},${yValue} ${x + r},${yValue} H${x + w - r} Q${x + w},${yValue} ${x + w},${yValue - r} V${yZero} Z`;
}

/**
 * Profit (or sales, ad spend, orders) per day / week / month as bars from a zero line — one measure at a time, never two
 * scales. Profit is signed: earning bars rise in green, losing bars drop in red. Hover or touch shows the bucket's whole
 * breakdown; ChartFrame adds the summary sentence and the same numbers as a table.
 */
export function ProfitChart({ buckets, grain, metric, highlight }: { buckets: ProfitBucket[]; grain: Grain; metric: ProfitMetric; highlight?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const values = buckets.map((b) => valueOf(b, metric));
    const rawMax = Math.max(0, ...values);
    const rawMin = Math.min(0, ...values);
    const span = rawMax - rawMin || 1;
    const max = rawMax === 0 && rawMin === 0 ? 1 : rawMax;
    const min = rawMin;
    const y = (v: number) => PAD.top + ((max - v) / (max - min || span)) * INNER_H;
    const slot = (width - PAD.left - PAD.right) / Math.max(1, buckets.length);
    const w = Math.max(2, Math.min(32, slot * 0.66));
    const ticks = [max, max / 2, 0, ...(min < 0 ? [min] : [])].filter((t, i, a) => a.indexOf(t) === i);
    return { values, y, slot, w, ticks, zero: y(0) };
  }, [buckets, metric, width]);

  const { summary, table } = useMemo(() => {
    const total = geo.values.reduce((s, v) => s + v, 0);
    const best = buckets.reduce<ProfitBucket | null>((top, b) => (!top || valueOf(b, metric) > valueOf(top, metric) ? b : top), null);
    const worst = buckets.reduce<ProfitBucket | null>((low, b) => (!low || valueOf(b, metric) < valueOf(low, metric) ? b : low), null);
    const unit = grain === "day" ? "day" : grain;
    const text = !best
      ? `${METRIC_LABEL[metric]} by ${unit}: nothing in this period.`
      : `${METRIC_LABEL[metric]} by ${unit}: ${format(Math.round(total * 100) / 100, metric)} in all. Best ${bucketLabel(best, grain, true)}, ${format(valueOf(best, metric), metric)}${worst && worst !== best ? `; lowest ${bucketLabel(worst, grain, true)}, ${format(valueOf(worst, metric), metric)}` : ""}.`;
    const t: ChartTableData = {
      caption: `Profit by ${unit}`,
      columns: [{ label: unit[0]!.toUpperCase() + unit.slice(1) }, { label: "Orders", align: "right" }, { label: "Sales", align: "right" }, { label: "Ads", align: "right" }, { label: "Other costs", align: "right" }, { label: "Profit", align: "right" }],
      rows: [...buckets].reverse().map((b) => ({ key: b.key, cells: [bucketLabel(b, grain, true), b.orders, money(b.sales), money(b.ads), money(b.goods + b.packaging + b.delivery + b.paymentFees + b.running), money(b.profit)] })),
    };
    return { summary: text, table: t };
  }, [buckets, grain, metric, geo.values]);

  const empty = geo.values.every((v) => v === 0);
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.min(grain === "month" ? 12 : 7, Math.floor((width - PAD.left) / 52))));
  const hovered = hover !== null ? buckets[hover] : undefined;

  function pick(clientX: number, rect: DOMRect) {
    const x = ((clientX - rect.left) / rect.width) * width - PAD.left;
    const i = Math.floor(x / geo.slot);
    setHover(i >= 0 && i < buckets.length ? i : null);
  }

  return (
    <ChartFrame summary={summary} table={table}>
      <div className="relative" ref={box}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="w-full touch-pan-y select-none"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
        >
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} className={t === 0 ? "stroke-ink-300" : "stroke-ink-100"} strokeWidth={1} />
              <text x={PAD.left - 8} y={geo.y(t)} dy={4} textAnchor="end" fontSize={10.5} className="fill-ink-400 tabular-nums">{compact(t, metric)}</text>
            </g>
          ))}

          {buckets.map((b, i) => {
            const v = geo.values[i]!;
            const x = PAD.left + i * geo.slot + (geo.slot - geo.w) / 2;
            const dim = (hover !== null && hover !== i) || (highlight !== undefined && hover === null && b.key !== highlight);
            const tone = metric === "profit" ? (v < 0 ? "fill-danger-500" : "fill-success-500") : "fill-accent";
            return <path key={b.key} d={barPath(x, geo.w, geo.y(v), geo.zero)} className={cn(tone, "transition-opacity duration-fast")} opacity={dim ? 0.35 : 1} />;
          })}

          {buckets.map((b, i) =>
            i % labelEvery === 0 || (labelEvery > 1 && i === buckets.length - 1 && (buckets.length - 1) % labelEvery > labelEvery / 2) ? (
              <text key={b.key} x={PAD.left + i * geo.slot + geo.slot / 2} y={HEIGHT - 8} fontSize={10.5} textAnchor="middle" className="fill-ink-400">
                {grain === "month" ? formatBusinessDate(b.from, { month: "short" }) : formatBusinessDate(b.from)}
              </text>
            ) : null,
          )}
        </svg>

        {empty && <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-fg-muted">Nothing in the books for these days yet.</p>}

        {hovered && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-56 -translate-x-1/2 rounded-2xl border border-line-subtle bg-surface px-4 py-3 shadow-lg"
            style={{ left: `${Math.min(84, Math.max(16, ((PAD.left + (hover! + 0.5) * geo.slot) / width) * 100))}%` }}
          >
            <p className="text-xs font-medium text-fg-muted">{bucketLabel(hovered, grain, true)}</p>
            <p className={cn("mt-0.5 text-lg font-semibold tabular-nums tracking-tight", hovered.profit < 0 ? "text-danger-600" : "text-fg")}>
              {hovered.profit < 0 ? `${money(-hovered.profit)} loss` : `${money(hovered.profit)} profit`}
            </p>
            <dl className="mt-2 space-y-1 text-xs">
              <Row label={`Sales · ${hovered.orders} order${hovered.orders === 1 ? "" : "s"}`} value={money(hovered.sales)} strong />
              <Row label="Goods & packaging" value={money(-(hovered.goods + hovered.packaging))} />
              <Row label="Delivery & fees" value={money(-(hovered.delivery + hovered.paymentFees))} />
              <Row label="Ads" value={money(-hovered.ads)} />
              {hovered.running !== 0 && <Row label="Running costs" value={money(-hovered.running)} />}
            </dl>
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "font-medium text-fg" : "text-fg-muted")}>{value}</dd>
    </div>
  );
}
