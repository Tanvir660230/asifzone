import { cn } from "@/lib/utils";
import { storeLayout } from "@/lib/theme-layout";
import { MihrabLoader } from "./presets/mihrab/loader";
import { TahafiLoader } from "./presets/tahafi/loader";

/** Zero-data-dependency loading state — shown instantly by Next.js while a route segment's
 * server data is still fetching, so it must never itself wait on anything (store name, logo).
 * `compact` drops the min-height/padding for tight spaces (e.g. the account auth card) where a
 * full-height spinner would push the layout around instead of just sitting where the form goes. */
export function BrandLoader({ label = "Loading", compact = false }: { label?: string; compact?: boolean }) {
  const layout = storeLayout();
  if (layout === "mihrab") return <MihrabLoader label={label} compact={compact} />;
  if (layout === "tahafi") return <TahafiLoader label={label} compact={compact} />;
  return (
    <div
      className={cn(
        "ui-delayed flex flex-col items-center justify-center gap-4",
        compact ? "py-10" : "min-h-[50vh] py-24",
      )}
      role="status"
      aria-live="polite"
    >
      <div className={compact ? "relative h-8 w-8" : "relative h-12 w-12"}>
        <div className="absolute inset-0 rounded-full border-2 border-ink-100" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-brass-400 border-r-brass-400" />
      </div>
      <p className="font-display text-sm tracking-[0.2em] text-ink-400">{label.toUpperCase()}</p>
      <span className="sr-only">{label}…</span>
    </div>
  );
}
