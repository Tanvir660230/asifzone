import { describe, it, expect } from "vitest";
import { editDistance, searchScore, searchWords } from "./stock-search";

// Smart stock page — search: every word typed must find a match (name, size, colour, SKU, kind), in any order; a typo of
// one letter (two in a long word) still matches; "12ml" and "12 ml" are the same; exact beats a prefix beats a typo.

const cap = searchWords({ productName: "Premium Pakistani Cap - Black A", size: "2XL 23.5", color: "Black", sku: "CAP-BLA-2XL", group: "FINISHED" });
const zayan = searchWords({ productName: "ZAYAN ELIXIR", size: "12ml", color: null, sku: "ATR-ZAY-12", group: "FILL_TO_ORDER" });
const bottle = searchWords({ productName: "Empty attar bottle 12 ml", size: null, color: null, sku: "MAT-BTL-12", group: "MATERIAL" });

describe("searchScore", () => {
  it("every word must match, in any order", () => {
    expect(searchScore("black 2xl cap", cap)).toBeGreaterThan(0);
    expect(searchScore("cap black 2xl", cap)).toBeGreaterThan(0);
    expect(searchScore("black cap brown", cap)).toBe(0);
  });
  it("a typo still finds it", () => {
    expect(searchScore("zayn", zayan)).toBeGreaterThan(0);
    expect(searchScore("pakistny cap", cap)).toBeGreaterThan(0);
    expect(searchScore("xyz", zayan)).toBe(0);
  });
  it("12ml, 12 ml and 12 are the same size", () => {
    expect(searchScore("zayan 12ml", zayan)).toBeGreaterThan(0);
    expect(searchScore("zayan 12 ml", zayan)).toBeGreaterThan(0);
    expect(searchScore("bottle 12", bottle)).toBeGreaterThan(0);
    expect(searchScore("bottle 6", bottle)).toBe(0);
  });
  it("the kind of item is searchable: attar, material, oil, bottle", () => {
    expect(searchScore("attar", zayan)).toBeGreaterThan(0);
    expect(searchScore("material bottle", bottle)).toBeGreaterThan(0);
  });
  it("SKU, whole or in part", () => {
    expect(searchScore("ATR-ZAY-12", zayan)).toBeGreaterThan(0);
    expect(searchScore("zay-12", zayan)).toBeGreaterThan(0);
  });
  it("exact beats prefix beats typo", () => {
    const exact = searchScore("elixir", zayan);
    const prefix = searchScore("elix", zayan);
    const typo = searchScore("elixor", zayan);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThan(0);
  });
  it("short words don't fuzzy-match (a 2-letter typo would match everything)", () => {
    expect(searchScore("xm", cap)).toBe(0);
  });
});

describe("editDistance", () => {
  it("counts a swap of two letters as one edit", () => {
    expect(editDistance("zayan", "zaayn")).toBe(1);
    expect(editDistance("black", "blakc")).toBe(1);
    expect(editDistance("oil", "oil")).toBe(0);
  });
});
