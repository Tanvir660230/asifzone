import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SummaryFigure {
  label: string;
  value: ReactNode;
  /** `warning` marks a count that needs a look (only when it is above 0); `accent` a money headline. */
  tone?: "default" | "warning" | "accent";
}

/**
 * A list page's headline numbers in one calm strip above the list (DESIGN_SYSTEM §6, density `kpi-strip`): one card,
 * figures side by side divided by hairlines, so the list starts high on the page instead of under a row of tall tiles.
 * Phones scroll the strip sideways rather than stacking it.
 */
export function SummaryStrip({ figures, loading, className }: { figures: SummaryFigure[]; loading?: boolean; className?: string }) {
  return (
    // Scrolls sideways on a phone, so it takes keyboard focus (WCAG 2.1.1 scrollable region).
    <div data-summary-strip="" role="region" aria-label="Summary" tabIndex={0} className={cn("mb-4 overflow-x-auto rounded-xl border border-line-subtle bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50", className)}>
      <dl className="flex min-h-kpi-strip min-w-max divide-x divide-line-subtle">
        {figures.map((f) => (
          <div key={f.label} className="flex min-w-[9rem] flex-1 flex-col justify-center px-4 py-2.5">
            <dt className="flex items-center gap-1.5 whitespace-nowrap text-xs text-fg-muted">
              {f.tone === "warning" && <span className="h-1.5 w-1.5 rounded-full bg-warning-500" aria-hidden />}
              {f.label}
            </dt>
            <dd className={cn("mt-0.5 whitespace-nowrap text-lg font-semibold tabular-nums leading-tight", f.tone === "accent" ? "text-accent" : "text-fg")}>
              {loading ? <span className="inline-block h-5 w-16 rounded ui-skeleton align-middle" aria-hidden /> : f.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
