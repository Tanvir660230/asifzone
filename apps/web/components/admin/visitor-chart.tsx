"use client";

import { useMemo, useState } from "react";
import type { VisitorPoint } from "@/lib/api/admin-analytics";

const WIDTH = 720;
const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 28, left: 40 };

export function VisitorChart({ data }: { data: VisitorPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { points, maxValue, visitorsPath, pageViewsPath } = useMemo(() => {
    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const max = Math.max(1, ...data.map((d) => d.pageViews));
    const step = data.length > 1 ? innerW / (data.length - 1) : 0;

    const pts = data.map((d, i) => ({
      x: PADDING.left + i * step,
      yVisitors: PADDING.top + innerH - (d.visitors / max) * innerH,
      yPageViews: PADDING.top + innerH - (d.pageViews / max) * innerH,
      ...d,
    }));

    const visitorsLine = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.yVisitors}`).join(" ");
    const pageViewsLine = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.yPageViews}`).join(" ");

    return { points: pts, maxValue: max, visitorsPath: visitorsLine, pageViewsPath: pageViewsLine };
  }, [data]);

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const labelEvery = Math.ceil(points.length / 6);
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
      <div className="mb-2 flex items-center gap-4 text-xs text-ink-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brass-500" /> Unique visitors
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ink-300" /> Pageviews
        </span>
      </div>
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
        {[0, 0.5, 1].map((frac) => {
          const y = PADDING.top + innerH * (1 - frac);
          return (
            <g key={frac}>
              <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} className="stroke-ink-100" strokeWidth={1} />
              <text x={PADDING.left - 8} y={y} dy={frac === 0 ? -2 : frac === 1 ? 10 : 4} textAnchor="end" fontSize={10} className="fill-ink-400">
                {Math.round(maxValue * frac)}
              </text>
            </g>
          );
        })}

        <path d={pageViewsPath} fill="none" className="stroke-ink-300" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <path d={visitorsPath} fill="none" className="stroke-brass-500" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

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
            <circle cx={hovered.x} cy={hovered.yVisitors} r={4} className="fill-brass-500 stroke-cream-50" strokeWidth={2} />
            <circle cx={hovered.x} cy={hovered.yPageViews} r={3} className="fill-ink-300 stroke-cream-50" strokeWidth={2} />
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
          <p className="text-ink-600">{hovered.visitors} visitor{hovered.visitors === 1 ? "" : "s"}</p>
          <p className="text-ink-400">{hovered.pageViews} pageview{hovered.pageViews === 1 ? "" : "s"}</p>
        </div>
      )}
    </div>
  );
}
