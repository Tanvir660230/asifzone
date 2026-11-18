import { describe, expect, it } from "vitest";
import { targetProgress } from "./target-progress";

describe("targetProgress", () => {
  it("compares the month so far with a straight-line pace and projects the month end", () => {
    // 10 of 30 days gone, 40,000 sold against a 90,000 target
    const p = targetProgress({ target: 90_000, actual: 40_000, elapsedDays: 10, daysInMonth: 30 });
    expect(p.expectedByToday).toBe(30_000);
    expect(p.percentDone).toBeCloseTo(44.44, 2);
    expect(p.projected).toBe(120_000);
    expect(p.status).toBe("ahead");
  });

  it("is behind when the month so far trails the pace by more than 5 %", () => {
    const p = targetProgress({ target: 90_000, actual: 25_000, elapsedDays: 10, daysInMonth: 30 });
    expect(p.status).toBe("behind");
    expect(p.projected).toBe(75_000);
  });

  it("is on track within 5 % of the pace either way", () => {
    expect(targetProgress({ target: 90_000, actual: 29_000, elapsedDays: 10, daysInMonth: 30 }).status).toBe("on-track");
    expect(targetProgress({ target: 90_000, actual: 31_000, elapsedDays: 10, daysInMonth: 30 }).status).toBe("on-track");
  });

  it("a finished month is met or missed, and projects exactly what happened", () => {
    expect(targetProgress({ target: 90_000, actual: 95_000, elapsedDays: 30, daysInMonth: 30 })).toMatchObject({ status: "met", projected: 95_000 });
    expect(targetProgress({ target: 90_000, actual: 80_000, elapsedDays: 30, daysInMonth: 30 })).toMatchObject({ status: "missed", projected: 80_000 });
  });

  it("with no target there is no pace, only the figure and its projection", () => {
    const p = targetProgress({ target: null, actual: 12_000, elapsedDays: 6, daysInMonth: 30 });
    expect(p).toMatchObject({ status: "no-target", percentDone: null, expectedByToday: null, projected: 60_000 });
  });

  it("a loss (negative profit) never projects a gain, and day 0 projects nothing", () => {
    expect(targetProgress({ target: 50_000, actual: -2_000, elapsedDays: 4, daysInMonth: 30 }).projected).toBe(-15_000);
    expect(targetProgress({ target: 50_000, actual: 0, elapsedDays: 0, daysInMonth: 30 })).toMatchObject({ projected: 0, expectedByToday: 0, status: "on-track" });
  });
});
