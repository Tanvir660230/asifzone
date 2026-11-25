import Link from "next/link";
import type { CategoryStockOverview } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";
import { storeLayout } from "@/lib/theme-layout";

export function CategoryStockPanel({ overview }: { overview: CategoryStockOverview }) {
  const { total, subcategories } = overview;
  const oneRow = storeLayout() === "tahafi";

  return (
    <div className="space-y-3 lg:mb-6">
      <p className="text-sm text-ink-500">
        <span className="font-medium text-ink-900">{total.totalProducts}</span> product{total.totalProducts === 1 ? "" : "s"}
        {total.inStockProducts < total.totalProducts && <> · {total.inStockProducts} in stock</>}
      </p>

      {subcategories.length > 0 && (
        <div>
          {/* The tahafi preset: no heading, and on phones the chips stay on one line that scrolls sideways (edge to edge),
              so the first products sit higher instead of below a stack of one-chip rows. */}
          <h3 className={cn("mb-3 text-xs ui-caps text-ink-500", oneRow && "sr-only")}>Categories</h3>
          <div
            className={cn(
              "flex gap-2",
              oneRow ? "-mx-4 snap-x overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" : "flex-wrap",
            )}
          >
            {subcategories.map((sub) => (
              <Link
                key={sub.id}
                href={`/category/${sub.slug}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-sm text-ink-700 transition-colors duration-150 ease-smooth hover:border-brass-400 hover:text-ink-900",
                  oneRow && "ui-tap-min shrink-0 snap-start whitespace-nowrap bg-surface",
                )}
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
