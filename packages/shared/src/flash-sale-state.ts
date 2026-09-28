/** Flash sale lifecycle (TARGET_ARCHITECTURE §16a): the admin's switch (`enabled`) is separate from the schedule
 * window. Live = enabled and inside the window; nothing else ever makes a sale live. */
export type FlashSalePhase = "DISABLED" | "SCHEDULED" | "LIVE" | "ENDED";

export function flashSalePhase(
  sale: { enabled: boolean; startsAt: Date | string; endsAt: Date | string },
  now: Date = new Date(),
): FlashSalePhase {
  const t = now.getTime();
  if (new Date(sale.endsAt).getTime() < t) return "ENDED";
  if (!sale.enabled) return "DISABLED";
  if (new Date(sale.startsAt).getTime() > t) return "SCHEDULED";
  return "LIVE";
}

export function isFlashSaleLive(sale: { enabled: boolean; startsAt: Date | string; endsAt: Date | string }, now: Date = new Date()): boolean {
  return flashSalePhase(sale, now) === "LIVE";
}
