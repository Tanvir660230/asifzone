import type { UrgencySignals as UrgencySignalsData } from "@clothing-brand/shared";
import { formatRelativeTime } from "@/lib/format";

interface UrgencySignalsProps {
  signals: UrgencySignalsData;
}

/** Renders only the lines backed by real data — nothing at all when every signal is empty.
 * No fabricated urgency: a quiet product page stays quiet. */
export function UrgencySignals({ signals }: UrgencySignalsProps) {
  const hasAny = signals.viewsToday > 0 || signals.recentPurchaseCount > 0 || signals.lastPurchasedAt || signals.isFastSelling;
  if (!hasAny) return null;

  return (
    <div className="mt-3 space-y-1 text-sm text-ink-600">
      {signals.viewsToday > 0 && (
        <p>
          👀 {signals.viewsToday} {signals.viewsToday === 1 ? "person" : "people"} viewed this today
        </p>
      )}
      {signals.recentPurchaseCount > 0 ? (
        <p>
          🛒 Purchased {signals.recentPurchaseCount} time{signals.recentPurchaseCount === 1 ? "" : "s"} in the last 24
          hours
        </p>
      ) : (
        signals.lastPurchasedAt && <p>Last purchased {formatRelativeTime(signals.lastPurchasedAt)}</p>
      )}
      {signals.isFastSelling && <p className="text-brass-600">🔥 Selling fast</p>}
    </div>
  );
}
