import { Eye, Flame } from "lucide-react";
import type { UrgencySignals as UrgencySignalsData } from "@clothing-brand/shared";

interface UrgencySignalsProps {
  signals: UrgencySignalsData;
}

/** Renders only the lines backed by real data — nothing at all when every signal is empty.
 * No fabricated urgency: a quiet product page stays quiet. Icons match the lucide set used
 * everywhere else on the storefront (trust badges, nav, footer) instead of raw emoji, which
 * render inconsistently across OS/browser emoji fonts and clash with the site's restrained,
 * monochrome-plus-one-accent palette.
 *
 * Views are a lifetime total, not "today" — a per-day count resets to a small number every
 * midnight and can look like nobody's interested on a slow morning; the running total only ever
 * climbs. Purchase counts (last 24h, last 7 days) are deliberately never shown to shoppers — the
 * shop doesn't reveal its sales volume; the units-sold figure is admin-only (AdminSalesBadge). */
export function UrgencySignals({ signals }: UrgencySignalsProps) {
  const hasAny = signals.totalViews > 0 || signals.isFastSelling;
  if (!hasAny) return null;

  return (
    <div className="mt-3 space-y-1.5 text-sm text-ink-600">
      {signals.totalViews > 0 && (
        <p className="flex items-center gap-1.5">
          <Eye size={14} className="shrink-0 text-ink-400" />
          {signals.totalViews} total view{signals.totalViews === 1 ? "" : "s"}
        </p>
      )}
      {signals.isFastSelling && (
        <p className="flex items-center gap-1.5 font-medium text-sale-500">
          <Flame size={14} className="shrink-0" />
          Selling fast
        </p>
      )}
    </div>
  );
}
