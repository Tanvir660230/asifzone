import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading state for account pages: a heading and a grouped list, the shape almost every account page has.
 * Sits inside the persistent shell, so the tabs never disappear while a page loads. */
export function AccountPageSkeleton({ header = true }: { header?: boolean } = {}) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {header && (
        <>
          <Skeleton className="h-9 w-56 rounded-lg" />
          <Skeleton className="mb-8 mt-3 h-4 w-80 max-w-full rounded" />
        </>
      )}
      <div className="overflow-hidden rounded-2xl bg-surface">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line-subtle p-4 last:border-0 sm:p-5">
            <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2 rounded" />
              <Skeleton className="h-3 w-1/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Loading state of the account home — the same blocks the home renders, so nothing jumps when data arrives. */
export function AccountHomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your account">
      <Skeleton className="h-12 w-80 max-w-full rounded-lg sm:h-14" />
      <Skeleton className="mt-4 h-5 w-[32rem] max-w-full rounded" />
      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-8">
          <Skeleton className="h-[22rem] rounded-3xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
        <div className="space-y-8">
          <Skeleton className="aspect-[1.586] rounded-[22px]" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
