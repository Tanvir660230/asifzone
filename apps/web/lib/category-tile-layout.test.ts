import { describe, expect, it } from "vitest";
import { categoryTileLayout } from "./category-tile-layout";

/** Splits a run of column spans into rows of `columns`, failing if a row would overflow or end short. */
function rows(spans: number[], columns: number) {
  const out: number[][] = [];
  let row: number[] = [];
  let used = 0;
  for (const span of spans) {
    row.push(span);
    used += span;
    if (used > columns) throw new Error(`row overflows: ${row.join("+")}`);
    if (used === columns) {
      out.push(row);
      row = [];
      used = 0;
    }
  }
  if (row.length) throw new Error(`last row ends short: ${row.join("+")}`);
  return out;
}

describe("categoryTileLayout", () => {
  it("gives every category exactly one cell and fills every row, for 1 to 12 categories", () => {
    for (let n = 1; n <= 12; n++) {
      const layout = categoryTileLayout(n);
      expect(layout).toHaveLength(n);
      expect(() => rows(layout.map((t) => t.lg), 12), `desktop, ${n}`).not.toThrow();
      expect(() => rows(layout.map((t) => t.sm), 2), `phone, ${n}`).not.toThrow();
    }
  });

  it("leads with two wide feature tiles from five categories", () => {
    expect(categoryTileLayout(6).map((t) => t.lg)).toEqual([6, 6, 3, 3, 3, 3]);
    expect(categoryTileLayout(5).map((t) => t.lg)).toEqual([6, 6, 4, 4, 4]);
    expect(categoryTileLayout(4).map((t) => t.lg)).toEqual([3, 3, 3, 3]);
  });

  it("spans the first tile across a phone row, and an odd one out at the end", () => {
    expect(categoryTileLayout(6).map((t) => t.sm)).toEqual([2, 1, 1, 1, 1, 2]);
    expect(categoryTileLayout(5).map((t) => t.sm)).toEqual([2, 1, 1, 1, 1]);
  });
});
