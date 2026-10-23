/**
 * Anomaly test (docs/METRICS_REGISTRY.md §4.9): is today's count far enough from the same weekday's recent history to be
 * worth a person's attention? Counts are noisy, so the spread used is the larger of the baseline's own standard deviation
 * and the Poisson noise of its mean (√mean) — a steady metric moves on a smaller change than a jumpy one. A move must be
 * both ≥ Z_THRESHOLD spreads AND ≥ MIN_ABS_CHANGE in absolute terms, so 0 vs a usual 1 never alarms. Pure.
 */

export const Z_THRESHOLD = 2.5;
export const MIN_ABS_CHANGE = 4;

export interface Anomaly {
  key: string;
  label: string;
  direction: "up" | "down";
  value: number;
  /** Mean of the baseline. */
  expected: number;
  /** % change against `expected`; null when expected is 0. */
  changePct: number | null;
  /** How many spreads away (for ordering). */
  score: number;
}

export function detectAnomaly(input: { key: string; label: string; value: number; baseline: number[] }): Anomaly | null {
  const { baseline, value } = input;
  if (baseline.length < 2) return null;
  const mean = baseline.reduce((s, v) => s + v, 0) / baseline.length;
  const sd = Math.sqrt(baseline.reduce((s, v) => s + (v - mean) ** 2, 0) / (baseline.length - 1));
  const spread = Math.max(sd, Math.sqrt(Math.max(mean, 1)));
  const diff = value - mean;
  if (Math.abs(diff) < MIN_ABS_CHANGE) return null;
  const score = Math.abs(diff) / spread;
  if (score < Z_THRESHOLD) return null;
  return {
    key: input.key,
    label: input.label,
    direction: diff > 0 ? "up" : "down",
    value,
    expected: mean,
    changePct: mean === 0 ? null : (diff / mean) * 100,
    score,
  };
}
