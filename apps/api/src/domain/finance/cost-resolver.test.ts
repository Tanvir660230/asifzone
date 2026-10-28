import { describe, expect, it } from "vitest";
import { resolveUnitCost, type CostFacts } from "./cost-resolver";

// Blueprint P-1 / owner decision Q1 = A: one cost answer for every screen.
const facts = (over: Partial<CostFacts>): CostFacts => ({ costingLive: true, costPolicy: "KNOWN_ONLY", bookAvgMinor: null, recipeMinor: null, catalogMinor: null, ...over });

describe("resolveUnitCost (P-1 table)", () => {
  it("costing live: the book average wins over recipe and catalog", () => {
    expect(resolveUnitCost(facts({ bookAvgMinor: 12_000, recipeMinor: 9_000, catalogMinor: 99_900 }))).toEqual({ unitCostMinor: 12_000, basis: "BOOK" });
  });
  it("costing live, never valued, fill-to-order recipe: provisional recipe cost", () => {
    expect(resolveUnitCost(facts({ recipeMinor: 9_000, catalogMinor: 99_900 }))).toEqual({ unitCostMinor: 9_000, basis: "PROVISIONAL" });
  });
  it("costing live, no position or recipe: the catalog only as a labelled estimate, and only when the policy allows estimates", () => {
    expect(resolveUnitCost(facts({ costPolicy: "APPROVED_ESTIMATES", catalogMinor: 20_000 }))).toEqual({ unitCostMinor: 20_000, basis: "ESTIMATED" });
    expect(resolveUnitCost(facts({ costPolicy: "KNOWN_ONLY", catalogMinor: 20_000 }))).toEqual({ unitCostMinor: null, basis: "MISSING" });
  });
  it("costing not live: the catalog cost, whatever the book holds", () => {
    expect(resolveUnitCost(facts({ costingLive: false, bookAvgMinor: 12_000, catalogMinor: 15_000 }))).toEqual({ unitCostMinor: 15_000, basis: "CATALOG" });
  });
  it("no source at all: missing, never 0", () => {
    expect(resolveUnitCost(facts({ costingLive: false }))).toEqual({ unitCostMinor: null, basis: "MISSING" });
    expect(resolveUnitCost(facts({ costPolicy: "APPROVED_ESTIMATES" }))).toEqual({ unitCostMinor: null, basis: "MISSING" });
  });
  it("a zero catalog cost is a real cost, not a missing one", () => {
    expect(resolveUnitCost(facts({ costingLive: false, catalogMinor: 0 }))).toEqual({ unitCostMinor: 0, basis: "CATALOG" });
  });
});
