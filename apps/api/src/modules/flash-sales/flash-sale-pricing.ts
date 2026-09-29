/** "Live right now": the admin's switch plus the schedule window, read directly — never the scheduler-maintained
 * `isActive` cache, so a sale starts/stops exactly on time and a disabled sale never prices anything.
 *
 * Flash PRICES are computed only by the pricing engine (packages/shared/src/engines/pricing.ts) via the pricing service —
 * the old computeFlashPrice / getActiveFlashInfoByProduct pair (which priced off the product base price) is gone. */
export function liveFlashSaleWhere(now: Date = new Date()) {
  return { enabled: true, startsAt: { lte: now }, endsAt: { gte: now } };
}
