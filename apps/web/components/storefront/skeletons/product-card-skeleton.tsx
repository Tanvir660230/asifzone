export function ProductCardSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="aspect-square rounded-xl ui-skeleton" />
      <div className="mt-3 space-y-1.5">
        <div className="h-2.5 w-1/3 rounded ui-skeleton" />
        <div className="h-3.5 w-4/5 rounded ui-skeleton" />
        <div className="h-3.5 w-1/3 rounded ui-skeleton" />
      </div>
    </div>
  );
}
