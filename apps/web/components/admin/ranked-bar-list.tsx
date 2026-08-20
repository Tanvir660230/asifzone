import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface RankedBarListItem {
  key: string;
  label: string;
  value: number;
  valueLabel: string;
  subLabel?: string;
  /** When set, the whole row becomes a link (e.g. to the product's admin edit page) — lets an owner
   * jump straight from "what's performing" to "go fix/inspect it" without a separate search. */
  href?: string;
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
      {items.map((item) => {
        const body = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1 truncate text-ink-800">
                <span className="truncate">{item.label}</span>
                {item.href && <ChevronRight size={13} className="shrink-0 text-ink-300 opacity-0 transition-opacity duration-150 ease-smooth group-hover:opacity-100" />}
              </span>
              <span className="shrink-0 pl-2 text-ink-500">{item.valueLabel}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-ink-100">
              <div className="h-2 rounded-full bg-brass-400" style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }} />
            </div>
            {item.subLabel && <p className="mt-0.5 text-xs text-ink-400">{item.subLabel}</p>}
          </>
        );

        return item.href ? (
          <Link key={item.key} href={item.href} className="group -mx-1.5 block rounded-lg px-1.5 py-0.5 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
            {body}
          </Link>
        ) : (
          <div key={item.key}>{body}</div>
        );
      })}
    </div>
  );
}
