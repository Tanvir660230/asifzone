/**
 * How a month is going against its target (docs/superpowers/plans/2026-11-18-business-reports.md, Part 1). Pure: the
 * caller supplies the figure so far and the store-local day count. The pace is a straight line — by day 10 of 30 a third
 * of the target "should" be done — which is how an owner reads a target, and simple to explain on screen.
 */
export type TargetStatus = "ahead" | "on-track" | "behind" | "met" | "missed" | "no-target";

export interface TargetProgress {
  target: number | null;
  actual: number;
  /** Share of the target done, in percent (null without a target). */
  percentDone: number | null;
  /** Where a straight-line pace would be today (null without a target). */
  expectedByToday: number | null;
  /** The month end if the rest of the month goes like the days so far. */
  projected: number;
  status: TargetStatus;
}

/** Within this share of the pace either way counts as on track. */
const ON_TRACK_BAND = 0.05;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function targetProgress(input: { target: number | null; actual: number; elapsedDays: number; daysInMonth: number }): TargetProgress {
  const { target, actual, daysInMonth } = input;
  const elapsed = Math.min(Math.max(input.elapsedDays, 0), daysInMonth);
  const finished = elapsed >= daysInMonth;
  const projected = finished ? actual : elapsed > 0 ? round2((actual / elapsed) * daysInMonth) : 0;

  if (target === null || target <= 0) {
    return { target: null, actual, percentDone: null, expectedByToday: null, projected, status: "no-target" };
  }

  const expectedByToday = round2((target * elapsed) / daysInMonth);
  const percentDone = round2((actual / target) * 100);
  let status: TargetStatus;
  if (finished) status = actual >= target ? "met" : "missed";
  else if (expectedByToday === 0) status = "on-track";
  else if (actual > expectedByToday * (1 + ON_TRACK_BAND)) status = "ahead";
  else if (actual < expectedByToday * (1 - ON_TRACK_BAND)) status = "behind";
  else status = "on-track";

  return { target, actual, percentDone, expectedByToday, projected, status };
}
