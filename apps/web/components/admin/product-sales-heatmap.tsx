"use client";

import { useMemo, useState } from "react";
import type { ProductSalesHeatmap as ProductSalesHeatmapData } from "@/lib/api/admin-analytics";

function formatDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Top-N-products × last-N-days units-sold grid — same sequential-hue, hover-updates-a-banner
 * pattern as TrafficHeatmap, applied to product sales instead of site traffic. */
export function ProductSalesHeatmap({ data }: { data: ProductSalesHeatmapData }) {
  const [hovered, setHovered] = useState<{ productName: string; day: string; qty: number } | null>(null);

  const max = useMemo(() => {
    let m = 0;
    for (const product of data.products) {
      for (const day of data.days) {
        const qty = data.cells[product.id]?.[day] ?? 0;
        if (qty > m) m = qty;
      }
    }
    return Math.max(1, m);
  }, [data]);

  if (data.products.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">No sales recorded yet for this window.</p>;
  }

  return (
    <div>
      <p className="mb-3 h-4 text-xs text-ink-500">
        {hovered ? `${hovered.productName} · ${formatDayLabel(hovered.day)} — ${hovered.qty} sold` : "Hover a cell for the exact count."}
      </p>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div
            className="mb-1 grid gap-[2px]"
            style={{ gridTemplateColumns: `140px repeat(${data.days.length}, 1fr)` }}
          >
            <div />
            {data.days.map((day, i) => (
              <div key={day} className="text-center text-[10px] text-ink-400">
                {i % 2 === 0 ? formatDayLabel(day) : ""}
              </div>
            ))}
          </div>
          {data.products.map((product) => (
            <div
              key={product.id}
              className="mb-[2px] grid gap-[2px]"
              style={{ gridTemplateColumns: `140px repeat(${data.days.length}, 1fr)` }}
            >
              <div className="truncate pr-2 text-xs text-ink-500" title={product.name}>
                {product.name}
              </div>
              {data.days.map((day) => {
                const qty = data.cells[product.id]?.[day] ?? 0;
                const alpha = qty === 0 ? 0.05 : 0.12 + (qty / max) * 0.78;
                return (
                  <div
                    key={day}
                    title={`${product.name} · ${formatDayLabel(day)} — ${qty} sold`}
                    onMouseEnter={() => setHovered({ productName: product.name, day, qty })}
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
