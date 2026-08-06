/** Zero-data-dependency loading state — shown instantly by Next.js while a route segment's
 * server data is still fetching, so it must never itself wait on anything (store name, logo). */
export function BrandLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 py-24" role="status" aria-live="polite">
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 rounded-full border-2 border-ink-100" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-brass-400 border-r-brass-400" />
      </div>
      <p className="font-display text-sm tracking-[0.2em] text-ink-400">{label.toUpperCase()}</p>
      <span className="sr-only">{label}…</span>
    </div>
  );
}
