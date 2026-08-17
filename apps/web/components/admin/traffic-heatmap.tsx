"use client";

import { useMemo, useState } from "react";
import type { HeatmapCell } from "@/lib/api/admin-analytics";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Sparse hour labels so the header doesn't turn into 24 crowded ticks.
const HOUR_LABEL_STEP = 3;

function formatHour(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/** Day-of-week × hour-of-day traffic grid, one sequential hue (ink) light→dark by pageview count.
 * A hovered cell updates the banner above the grid instead of a floating tooltip — simpler to
 * position correctly across 168 small cells. */
export function TrafficHeatmap({ cells }: { cells: HeatmapCell[] }) {
  const [hovered, setHovered] = useState<HeatmapCell | null>(null);

  const { grid, max } = useMemo(() => {
    const g: HeatmapCell[][] = Array.from({ length: 7 }, () => Array(24).fill(null));
    let m = 0;
    for (const cell of cells) {
      g[cell.dow]![cell.hour] = cell;
      if (cell.count > m) m = cell.count;
    }
    return { grid: g, max: Math.max(1, m) };
  }, [cells]);

  if (cells.every((c) => c.count === 0)) {
    return <p className="py-8 text-center text-sm text-ink-400">No pageview data yet for this window.</p>;
  }

  return (
    <div>
      <p className="mb-3 h-4 text-xs text-ink-500">
        {hovered
          ? `${DAY_LABELS[hovered.dow]} · ${formatHour(hovered.hour)} — ${hovered.count} pageview${hovered.count === 1 ? "" : "s"}`
          : "Hover a cell for the exact count."}
      </p>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="mb-1 grid grid-cols-[32px_repeat(24,1fr)] gap-[2px]">
            <div />
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="text-center text-[10px] text-ink-400">
                {hour % HOUR_LABEL_STEP === 0 ? formatHour(hour) : ""}
              </div>
            ))}
          </div>
          {grid.map((row, dow) => (
            <div key={dow} className="mb-[2px] grid grid-cols-[32px_repeat(24,1fr)] gap-[2px]">
              <div className="flex items-center text-xs text-ink-500">{DAY_LABELS[dow]}</div>
              {row.map((cell, hour) => {
                const alpha = cell.count === 0 ? 0.05 : 0.12 + (cell.count / max) * 0.78;
                return (
                  <div
                    key={hour}
                    title={`${DAY_LABELS[dow]} ${formatHour(hour)} — ${cell.count} pageview${cell.count === 1 ? "" : "s"}`}
                    onMouseEnter={() => setHovered(cell)}
                    onMouseLeave={() => setHovered(null)}
                    className="aspect-square rounded-sm"
                    style={{ backgroundColor: `rgba(17,17,17,${alpha})` }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-ink-400">
        <span>Less</span>
        {[0.05, 0.2, 0.4, 0.6, 0.9].map((alpha) => (
          <span key={alpha} className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: `rgba(17,17,17,${alpha})` }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
