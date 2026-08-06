export function ProductCardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-square rounded-xl bg-ink-100" />
      <div className="mt-3 space-y-1.5">
        <div className="h-2.5 w-1/3 rounded bg-ink-100" />
        <div className="h-3.5 w-4/5 rounded bg-ink-100" />
        <div className="h-3.5 w-1/3 rounded bg-ink-100" />
      </div>
    </div>
  );
}
