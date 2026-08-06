import { ProductGridSkeleton } from "./product-grid-skeleton";

export function ProductListingSkeleton() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-3 w-40 rounded bg-ink-100" />
      <div className="mb-8 mt-4 flex items-end justify-between">
        <div className="h-8 w-56 rounded bg-ink-100" />
        <div className="h-8 w-32 rounded bg-ink-100" />
      </div>
      <div className="flex gap-10">
        <div className="hidden w-56 shrink-0 space-y-6 lg:block">
          <div className="space-y-3">
            <div className="h-2.5 w-10 rounded bg-ink-100" />
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-9 w-9 rounded-full bg-ink-100" />
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div className="h-2.5 w-12 rounded bg-ink-100" />
            <div className="flex flex-wrap gap-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 w-8 rounded-full bg-ink-100" />
              ))}
            </div>
          </div>
        </div>
        <div className="flex-1">
          <ProductGridSkeleton />
        </div>
      </div>
    </div>
  );
}
