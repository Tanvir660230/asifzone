import { Flame } from "lucide-react";
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
 * The view count and sales counts are never sent to shoppers at all (the public API carries only this yes/no flag) — the
 * shop doesn't reveal its traffic or sales volume; views and units sold are admin-only (AdminSalesBadge). */
export function UrgencySignals({ signals }: UrgencySignalsProps) {
  if (!signals.isFastSelling) return null;

  return (
    <div className="mt-3 space-y-1.5 text-sm text-ink-600">
      {signals.isFastSelling && (
        <p className="flex items-center gap-1.5 font-medium text-sale-500">
          <Flame size={14} className="shrink-0" />
          Selling fast
        </p>
      )}
    </div>
  );
}
