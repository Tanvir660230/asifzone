export interface RankedBarListItem {
  key: string;
  label: string;
  value: number;
  valueLabel: string;
  subLabel?: string;
}

/** Same horizontal-bar-ranked-by-value look as TopProductsChart, generalized for the several new
 * analytics sections (most-viewed products, top categories/brands, search queries, traffic
 * sources, campaigns) that all reduce to "label, bar proportional to a number, formatted value". */
export function RankedBarList({ items, emptyLabel }: { items: RankedBarListItem[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">{emptyLabel}</p>;
  }

  const max = Math.max(...items.map((i) => i.value));

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.key}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="truncate text-ink-800">{item.label}</span>
            <span className="shrink-0 pl-2 text-ink-500">{item.valueLabel}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-ink-100">
            <div className="h-2 rounded-full bg-brass-400" style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }} />
          </div>
          {item.subLabel && <p className="mt-0.5 text-xs text-ink-400">{item.subLabel}</p>}
        </div>
      ))}
    </div>
  );
}
