import type { TargetStatus } from "./target-progress";

/**
 * The colour of one scorecard figure (docs/superpowers/plans/2026-11-18-business-reports.md, Part 2), stated as a rule
 * the owner can read on the page: a figure with a target follows the target (ahead / on track / met = good, behind /
 * missed = bad); otherwise it is compared with the same number of days just before — up to 5 % worse is good, 5–15 %
 * worse is "watch", more is bad. A loss is always bad. Figures with no better direction (ad spend) stay neutral.
 */
export type ScorecardStatus = "good" | "watch" | "bad" | "neutral";

export function scorecardStatus(input: {
  value: number;
  previous: number | null;
  better: "higher" | "lower" | null;
  targetStatus?: TargetStatus;
  mustBePositive?: boolean;
}): ScorecardStatus {
  const { value, previous, better, targetStatus, mustBePositive } = input;
  if (mustBePositive && value < 0) return "bad";
  if (targetStatus && targetStatus !== "no-target") return targetStatus === "behind" || targetStatus === "missed" ? "bad" : "good";
  if (!better || previous === null || previous === 0) return "neutral";
  // how much worse, as a share of the earlier figure (negative = better)
  const worse = better === "higher" ? (previous - value) / Math.abs(previous) : (value - previous) / Math.abs(previous);
  if (worse <= 0.05) return "good";
  if (worse <= 0.15) return "watch";
  return "bad";
}
