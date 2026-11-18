import { describe, expect, it } from "vitest";
import { scorecardStatus } from "./scorecard-status";

describe("scorecardStatus", () => {
  it("a target decides when there is one: behind or missed is red, on track amber only when just behind", () => {
    expect(scorecardStatus({ value: 10, previous: 1, better: "higher", targetStatus: "ahead" })).toBe("good");
    expect(scorecardStatus({ value: 10, previous: 1, better: "higher", targetStatus: "on-track" })).toBe("good");
    expect(scorecardStatus({ value: 10, previous: 100, better: "higher", targetStatus: "met" })).toBe("good");
    expect(scorecardStatus({ value: 10, previous: 1, better: "higher", targetStatus: "behind" })).toBe("bad");
    expect(scorecardStatus({ value: 10, previous: 1, better: "higher", targetStatus: "missed" })).toBe("bad");
  });

  it("without a target, higher-is-better compares with the same number of days before", () => {
    expect(scorecardStatus({ value: 100, previous: 100, better: "higher" })).toBe("good");
    expect(scorecardStatus({ value: 96, previous: 100, better: "higher" })).toBe("good"); // within 5 %
    expect(scorecardStatus({ value: 90, previous: 100, better: "higher" })).toBe("watch"); // 10 % down
    expect(scorecardStatus({ value: 80, previous: 100, better: "higher" })).toBe("bad"); // 20 % down
  });

  it("lower-is-better (returns, cancellations) turns the comparison round", () => {
    expect(scorecardStatus({ value: 0.1, previous: 0.1, better: "lower" })).toBe("good");
    expect(scorecardStatus({ value: 0.11, previous: 0.1, better: "lower" })).toBe("watch");
    expect(scorecardStatus({ value: 0.13, previous: 0.1, better: "lower" })).toBe("bad");
    expect(scorecardStatus({ value: 0.05, previous: 0.1, better: "lower" })).toBe("good");
  });

  it("nothing to compare with, or a figure that is neither good nor bad, is neutral", () => {
    expect(scorecardStatus({ value: 50, previous: 0, better: "higher" })).toBe("neutral");
    expect(scorecardStatus({ value: 50, previous: null, better: "higher" })).toBe("neutral");
    expect(scorecardStatus({ value: 50, previous: 40, better: null })).toBe("neutral");
  });

  it("a loss is bad whatever came before", () => {
    expect(scorecardStatus({ value: -500, previous: -2000, better: "higher", mustBePositive: true })).toBe("bad");
  });
});
