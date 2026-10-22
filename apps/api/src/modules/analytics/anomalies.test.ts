import { describe, it, expect } from "vitest";
import { detectAnomaly } from "./anomalies";

describe("detectAnomaly", () => {
  it("flags a clear drop against a steady baseline", () => {
    const a = detectAnomaly({ key: "placed", label: "Orders", value: 4, baseline: [20, 22, 18, 21] });
    expect(a).toMatchObject({ direction: "down", expected: 20.25 });
    expect(a!.changePct).toBeCloseTo(-80.2, 0);
  });

  it("flags a clear spike", () => {
    expect(detectAnomaly({ key: "returned", label: "Refused", value: 9, baseline: [1, 2, 1, 2] })).toMatchObject({ direction: "up" });
  });

  it("ignores normal day-to-day noise", () => {
    expect(detectAnomaly({ key: "placed", label: "Orders", value: 17, baseline: [20, 22, 18, 21] })).toBeNull();
    expect(detectAnomaly({ key: "placed", label: "Orders", value: 26, baseline: [20, 22, 18, 21] })).toBeNull();
  });

  it("never alarms on tiny numbers (0 vs a usual 1 is not news)", () => {
    expect(detectAnomaly({ key: "returned", label: "Refused", value: 0, baseline: [1, 2, 1, 1] })).toBeNull();
    expect(detectAnomaly({ key: "returned", label: "Refused", value: 3, baseline: [0, 0, 1, 0] })).toBeNull();
  });

  it("a noisy baseline needs a bigger move", () => {
    // Same mean as the steady case, but the weeks swing wildly: 9 is within what this metric does.
    expect(detectAnomaly({ key: "placed", label: "Orders", value: 9, baseline: [5, 35, 6, 35] })).toBeNull();
  });

  it("needs at least two baseline days", () => {
    expect(detectAnomaly({ key: "placed", label: "Orders", value: 0, baseline: [30] })).toBeNull();
  });
});
