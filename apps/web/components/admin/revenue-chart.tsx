"use client";

import { useMemo, useState } from "react";
import type { RevenuePoint } from "@/lib/api/admin-analytics";
import { formatPrice } from "@/lib/format";

const WIDTH = 720;
const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 28, left: 52 };

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

    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const area = `${line} L ${pts[pts.length - 1]?.x ?? 0} ${PADDING.top + innerH} L ${pts[0]?.x ?? 0} ${PADDING.top + innerH} Z`;

    return { points: pts, maxRevenue: max, areaPath: area, linePath: line };
  }, [data]);

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const labelEvery = Math.ceil(points.length / 6);
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
          let closest = 0;
          let closestDist = Infinity;
          points.forEach((p, i) => {
            const dist = Math.abs(p.x - relX);
            if (dist < closestDist) {
              closestDist = dist;
              closest = i;
            }
          });
          setHoverIndex(closest);
        }}
      >
        {/* recessive gridlines + y-axis labels */}
        {[0, 0.5, 1].map((frac) => {
          const y = PADDING.top + innerH * (1 - frac);
          return (
            <g key={frac}>
              <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} className="stroke-ink-100" strokeWidth={1} />
              <text x={PADDING.left - 8} y={y} dy={frac === 0 ? -2 : frac === 1 ? 10 : 4} textAnchor="end" fontSize={10} className="fill-ink-400">
                {formatCompactPrice(maxRevenue * frac)}
              </text>
            </g>
          );
        })}

        <path d={areaPath} className="fill-brass-400/10" stroke="none" />
        <path d={linePath} fill="none" className="stroke-brass-500" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {points.map(
          (p, i) =>
            i % labelEvery === 0 && (
              <text key={p.date} x={p.x} y={HEIGHT - 8} fontSize={10} className="fill-ink-400" textAnchor="middle">
                {new Date(p.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </text>
            ),
        )}

        {hovered && (
          <>
            <line x1={hovered.x} x2={hovered.x} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} className="stroke-ink-200" strokeWidth={1} />
            <circle cx={hovered.x} cy={hovered.y} r={4} className="fill-brass-500 stroke-cream-50" strokeWidth={2} />
          </>
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded border border-ink-100 bg-cream-50 px-3 py-2 text-xs shadow-md"
          style={{ left: `${(hovered.x / WIDTH) * 100}%` }}
        >
          <p className="font-medium text-ink-900">
            {new Date(hovered.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </p>
          <p className="text-ink-600">{formatPrice(hovered.revenue)}</p>
          <p className="text-ink-400">
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
