export function ProductDetailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-3 w-48 rounded bg-ink-100" />
      <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div className="aspect-square rounded-xl bg-ink-100" />
        <div className="space-y-4">
          <div className="h-2.5 w-20 rounded bg-ink-100" />
          <div className="h-7 w-3/4 rounded bg-ink-100" />
          <div className="h-5 w-24 rounded bg-ink-100" />
          <div className="space-y-2 pt-6">
            <div className="h-2.5 w-12 rounded bg-ink-100" />
            <div className="flex gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 w-10 rounded-full bg-ink-100" />
              ))}
            </div>
          </div>
          <div className="space-y-2 pt-2">
            <div className="h-2.5 w-14 rounded bg-ink-100" />
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 w-9 rounded-full bg-ink-100" />
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <div className="h-12 flex-1 rounded-full bg-ink-100" />
            <div className="h-12 flex-1 rounded-full bg-ink-100" />
          </div>
        </div>
      </div>
    </div>
  );
}
