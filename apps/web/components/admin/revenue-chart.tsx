"use client";

import { useMemo, useState } from "react";
import type { RevenuePoint } from "@/lib/api/admin-analytics";
import { formatPrice } from "@/lib/format";

const WIDTH = 760;
const HEIGHT = 280;
const PADDING = { top: 16, right: 16, bottom: 28, left: 56 };
const GRID_FRACTIONS = [0, 1 / 3, 2 / 3, 1];

/** Catmull-Rom -> cubic Bezier conversion (tension 1) — draws a smooth curve that still passes
 * through every data point, unlike a fitted approximation that would blur the real numbers. */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return points[0] ? `M ${points[0].x} ${points[0].y}` : "";
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { points, maxRevenue, areaPath, linePath } = useMemo(() => {
    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const max = Math.max(1, ...data.map((d) => d.revenue));
    const step = data.length > 1 ? innerW / (data.length - 1) : 0;

    const pts = data.map((d, i) => ({
      x: PADDING.left + i * step,
      y: PADDING.top + innerH - (d.revenue / max) * innerH,
      ...d,
    }));

    const line = smoothPath(pts);
    const lastX = pts[pts.length - 1]?.x ?? 0;
    const firstX = pts[0]?.x ?? 0;
    const area = `${line} L ${lastX} ${PADDING.top + innerH} L ${firstX} ${PADDING.top + innerH} Z`;

    return { points: pts, maxRevenue: max, areaPath: area, linePath: line };
  }, [data]);

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  function pickNearestPoint(clientX: number, rect: DOMRect) {
    const relX = ((clientX - rect.left) / rect.width) * WIDTH;
    let closest = 0;
    let closestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - relX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    return closest;
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => setHoverIndex(pickNearestPoint(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          if (touch) setHoverIndex(pickNearestPoint(touch.clientX, e.currentTarget.getBoundingClientRect()));
        }}
        onTouchMove={(e) => {
          const touch = e.touches[0];
          if (touch) setHoverIndex(pickNearestPoint(touch.clientX, e.currentTarget.getBoundingClientRect()));
        }}
        onTouchEnd={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.14} className="text-ink-900" />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} className="text-ink-900" />
          </linearGradient>
        </defs>

        {/* recessive gridlines + y-axis labels */}
        {GRID_FRACTIONS.map((frac) => {
          const y = PADDING.top + innerH * (1 - frac);
          return (
            <g key={frac}>
              <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} className="stroke-ink-100" strokeWidth={1} />
              <text
                x={PADDING.left - 10}
                y={y}
                dy={frac === 0 ? -2 : frac === 1 ? 10 : 4}
                textAnchor="end"
                fontSize={10.5}
                className="fill-ink-400"
              >
                {formatCompactPrice(maxRevenue * frac)}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#revenueFill)" stroke="none" />
        <path d={linePath} fill="none" className="stroke-ink-900" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />

        {points.map(
          (p, i) =>
            i % labelEvery === 0 && (
              <text key={p.date} x={p.x} y={HEIGHT - 8} fontSize={10.5} className="fill-ink-400" textAnchor="middle">
                {new Date(p.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </text>
            ),
        )}

        {hovered && (
          <g>
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              className="stroke-ink-200"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={hovered.x} cy={hovered.y} r={5} className="fill-ink-900 stroke-cream-50" strokeWidth={2.5} />
          </g>
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-[9.5rem] -translate-x-1/2 rounded-2xl border border-ink-100 bg-cream-50 px-4 py-3 shadow-lg"
          style={{ left: `${(hovered.x / WIDTH) * 100}%` }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            {new Date(hovered.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-ink-900">{formatPrice(hovered.revenue)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-900" />
            {hovered.orders} order{hovered.orders === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </div>
  );
}

function formatCompactPrice(value: number): string {
  if (value >= 1000) return `৳${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `৳${Math.round(value)}`;
}
