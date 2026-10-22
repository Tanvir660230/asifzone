import { describe, it, expect } from "vitest";
import { decompose, movers } from "./why-changed";

describe("decompose (log-mean, exact)", () => {
  it("splits a product's change into its factors' effects, which add up to the whole change", () => {
    // orders = visits × conversion: 1000 × 2% = 20  →  1500 × 2% = 30. All of the +10 is visitors.
    const d = decompose({ visits: [1000, 1500], conversion: [0.02, 0.02] });
    expect(d.total).toBeCloseTo(10);
    expect(d.effects.visits).toBeCloseTo(10);
    expect(d.effects.conversion).toBeCloseTo(0);
  });

  it("mixed moves: the effects still sum exactly to the change", () => {
    // 1000 × 3% = 30  →  1200 × 2% = 24  (−6): more visitors (+), worse conversion (−)
    const d = decompose({ visits: [1000, 1200], conversion: [0.03, 0.02] });
    expect(d.total).toBeCloseTo(-6);
    expect(d.effects.visits).toBeGreaterThan(0);
    expect(d.effects.conversion).toBeLessThan(0);
    expect(d.effects.visits + d.effects.conversion).toBeCloseTo(-6, 9);
  });

  it("an unchanged total has no effects", () => {
    const d = decompose({ orders: [10, 10], aov: [500, 500] });
    expect(d).toEqual({ before: 5000, after: 5000, total: 0, effects: { orders: 0, aov: 0 } });
  });

  it("falls back to a simple split when a factor is zero (log of 0 is undefined)", () => {
    const d = decompose({ orders: [0, 10], aov: [0, 500] });
    expect(d.total).toBe(5000);
    expect(d.effects.orders + d.effects.aov).toBeCloseTo(5000, 9);
  });
});

describe("movers", () => {
  it("the biggest rises and falls between two periods, new and vanished groups included", () => {
    const m = movers(
      new Map([
        ["A", 100],
        ["B", 300],
        ["C", 50],
      ]),
      new Map([
        ["A", 400],
        ["B", 100],
        ["D", 80],
      ]),
      2,
    );
    expect(m.up).toEqual([
      { key: "A", before: 100, after: 400, change: 300 },
      { key: "D", before: 0, after: 80, change: 80 },
    ]);
    expect(m.down).toEqual([
      { key: "B", before: 300, after: 100, change: -200 },
      { key: "C", before: 50, after: 0, change: -50 },
    ]);
  });
});
