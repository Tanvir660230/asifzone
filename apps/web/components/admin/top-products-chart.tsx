import Link from "next/link";
import { Package, PackageSearch } from "lucide-react";
import type { TopProduct } from "@/lib/api/admin-analytics";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

// First three get a graded dark-to-light badge so #1 reads unmistakably as #1; everything past
// that is a neutral tie rather than an arbitrary shade.
const RANK_STYLE = ["bg-ink-900 text-cream-50", "bg-ink-700 text-cream-50", "bg-ink-500 text-cream-50"];

export function TopProductsChart({ products }: { products: TopProduct[] }) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <PackageSearch size={22} className="text-ink-300" />
        <p className="text-sm text-ink-500">No sales in this period yet.</p>
      </div>
    );
  }

  const max = Math.max(...products.map((p) => p.revenue));

  return (
    <div className="divide-y divide-ink-100">
      {products.map((p, i) => {
        const row = (
          <div className="group flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                RANK_STYLE[i] ?? "bg-ink-100 text-ink-500",
              )}
            >
              {i + 1}
            </span>

            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-ink-100 bg-ink-50">
              {p.imageUrl ? (
                <img src={resolveImageUrl(p.imageUrl)} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Package size={16} className="text-ink-300" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium text-ink-900">{p.name}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">{formatPrice(p.revenue)}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full bg-ink-900 transition-all duration-500 ease-smooth"
                  style={{ width: `${max > 0 ? (p.revenue / max) * 100 : 0}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-ink-400">{p.quantitySold} sold</p>
            </div>
          </div>
        );

        return p.productId ? (
          <Link
            key={p.name}
            href={`/admin/products/${p.productId}/edit`}
            className="-mx-1 block rounded-xl px-1 transition-colors duration-150 ease-smooth hover:bg-ink-50/60"
          >
            {row}
          </Link>
        ) : (
          <div key={p.name}>{row}</div>
        );
      })}
    </div>
  );
}
