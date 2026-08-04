export function formatPrice(value: string | number): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return `৳${amount.toLocaleString("en-BD")}`;
}

/** Percent change vs. a prior-period baseline, for trend indicators. Null when there's no baseline to compare against. */
export function computeTrendPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? null : 100;
  return ((current - previous) / previous) * 100;
}
