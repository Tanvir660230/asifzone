import Link from "next/link";
import type { CategoryStockOverview } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";

export function CategoryStockPanel({ overview }: { overview: CategoryStockOverview }) {
  const { total, subcategories } = overview;

  return (
    <div className="mb-6 space-y-3">
      <p className="text-sm text-ink-500">
        <span className="font-medium text-ink-900">{total.inStockProducts}</span> of {total.totalProducts} product
        {total.totalProducts === 1 ? "" : "s"} in stock
        {total.totalStock > 0 && <> &middot; {total.totalStock} units available</>}
      </p>

      {subcategories.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs uppercase tracking-wide text-ink-500">Categories</h3>
          <div className="flex flex-wrap gap-2">
            {subcategories.map((sub) => (
              <Link
                key={sub.id}
                href={`/category/${sub.slug}`}
                className="flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-sm text-ink-700 transition-colors duration-150 ease-smooth hover:border-brass-400 hover:text-ink-900"
              >
                {sub.name}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    sub.inStockProducts > 0 ? "bg-ink-100 text-ink-600" : "bg-ink-50 text-ink-300",
                  )}
                >
                  {sub.inStockProducts}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
