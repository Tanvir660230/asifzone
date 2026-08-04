import type { TopProduct } from "@/lib/api/admin-analytics";
import { formatPrice } from "@/lib/format";

export function TopProductsChart({ products }: { products: TopProduct[] }) {
  if (products.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">No sales in this period yet.</p>;
  }

  const max = Math.max(...products.map((p) => p.revenue));

  return (
    <div className="space-y-3">
      {products.map((p) => (
        <div key={p.name}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-ink-800">{p.name}</span>
            <span className="text-ink-500">{formatPrice(p.revenue)}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-ink-100">
            <div
              className="h-2 rounded-full bg-brass-400"
              style={{ width: `${max > 0 ? (p.revenue / max) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-0.5 text-xs text-ink-400">{p.quantitySold} sold</p>
        </div>
      ))}
    </div>
  );
}
