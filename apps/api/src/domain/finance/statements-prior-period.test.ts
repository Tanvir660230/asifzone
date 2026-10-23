import { describe, it, expect } from "vitest";
import { priorPeriod } from "./statements.service";

// The income statement's comparison period: month for month when the period starts on the 1st, else the same number of
// days just before.

describe("priorPeriod", () => {
  it("a whole month is compared with the whole month before, whatever their lengths", () => {
    expect(priorPeriod("2026-10-01", "2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(priorPeriod("2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(priorPeriod("2026-01-01", "2026-01-31")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("month to date is compared with the same days of the month before; a day past its end is its last day", () => {
    expect(priorPeriod("2026-10-01", "2026-10-22")).toEqual({ from: "2026-09-01", to: "2026-09-22" });
    expect(priorPeriod("2026-03-01", "2026-03-30")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("a quarter is compared with the quarter before", () => {
    expect(priorPeriod("2026-07-01", "2026-09-30")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  it("any other range: the same number of days just before it", () => {
    expect(priorPeriod("2026-10-10", "2026-10-16")).toEqual({ from: "2026-10-03", to: "2026-10-09" });
  });
});
