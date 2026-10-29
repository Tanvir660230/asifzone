import { describe, expect, it } from "vitest";
import { compareAsDuplicate } from "./duplicate-purchase";

// Blueprint P0.3 (owner Q7): a warning needs ALL FOUR — same supplier (the caller's filter), ±3 days, ≥ 70% items, total ±1%.
const base = { date: "2026-10-10", variantIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], totalMinor: 1_000_000 };

describe("compareAsDuplicate", () => {
  it("the same purchase entered twice matches", () => {
    expect(compareAsDuplicate(base, { ...base })).toEqual({ itemOverlap: 1, totalDifference: 0 });
  });
  it("3 days apart still matches; 4 days does not", () => {
    expect(compareAsDuplicate(base, { ...base, date: "2026-10-13" })).not.toBeNull();
    expect(compareAsDuplicate(base, { ...base, date: "2026-10-07" })).not.toBeNull();
    expect(compareAsDuplicate(base, { ...base, date: "2026-10-14" })).toBeNull();
  });
  it("70% of the items in common matches; 60% does not", () => {
    expect(compareAsDuplicate(base, { ...base, variantIds: ["a", "b", "c", "d", "e", "f", "g", "x", "y", "z"] })).toMatchObject({ itemOverlap: 0.7 });
    expect(compareAsDuplicate(base, { ...base, variantIds: ["a", "b", "c", "d", "e", "f", "w", "x", "y", "z"] })).toBeNull();
  });
  it("overlap is measured against the larger purchase, so a small subset of a big one does not match", () => {
    expect(compareAsDuplicate(base, { ...base, variantIds: ["a", "b"] })).toBeNull();
  });
  it("totals 1% apart match; 1.5% apart do not", () => {
    expect(compareAsDuplicate(base, { ...base, totalMinor: 990_000 })).toMatchObject({ totalDifference: 0.01 });
    expect(compareAsDuplicate(base, { ...base, totalMinor: 1_015_000 })).toBeNull();
  });
  it("repeated quantities of one item count once", () => {
    expect(compareAsDuplicate({ ...base, variantIds: ["a", "a"] }, { ...base, variantIds: ["a"] })).toMatchObject({ itemOverlap: 1 });
  });
});
