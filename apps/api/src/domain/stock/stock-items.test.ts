import { describe, it, expect } from "vitest";
import { classify, limitingMaterial, rankOf, suggestReorder } from "./stock-items.service";

// Smart stock page, task 2 (pure parts): status, reorder suggestion, urgency order and the material that limits a fill.

const item = (over: Record<string, unknown> = {}) => ({
  stock: 10, makeable: null as number | null, low: false, daysLeft: null as number | null,
  policy: null as { owed: number; policy: "TRACKED" | "UNLIMITED" | "BACKORDER" } | null, ...over,
});

describe("classify", () => {
  it("owed bottles → NEEDS_FILL, even when more can be made", () => {
    expect(classify(item({ stock: -3, makeable: 40, policy: { owed: 3, policy: "TRACKED" } }) as never)).toBe("NEEDS_FILL");
  });
  it("nothing to sell → OUT", () => {
    expect(classify(item({ stock: 0 }) as never)).toBe("OUT");
    expect(classify(item({ stock: 0, makeable: 0, policy: { owed: 0, policy: "TRACKED" } }) as never)).toBe("OUT");
  });
  it("an attar on UNLIMITED is never OUT", () => {
    expect(classify(item({ stock: 0, makeable: 1_000_000, policy: { owed: 0, policy: "UNLIMITED" } }) as never)).toBe("OK");
  });
  it("low → LOW, else OK", () => {
    expect(classify(item({ low: true }) as never)).toBe("LOW");
    expect(classify(item() as never)).toBe("OK");
  });
});

describe("suggestReorder", () => {
  it("10 a day, 3 days to arrive, 30 days cover, 100 on hand → 230, order in 7 days", () => {
    expect(suggestReorder({ usedPerDay: 10, available: 100, leadTimeDays: 3, coverDays: 30, today: "2026-10-24" })).toEqual({ suggested: 230, orderBy: "2026-10-31" });
  });
  it("already past the order date → order today", () => {
    expect(suggestReorder({ usedPerDay: 10, available: 20, leadTimeDays: 5, coverDays: 30, today: "2026-10-24" })).toEqual({ suggested: 330, orderBy: "2026-10-24" });
  });
  it("enough on hand → suggests 0", () => {
    expect(suggestReorder({ usedPerDay: 1, available: 500, leadTimeDays: 3, coverDays: 30, today: "2026-10-24" })?.suggested).toBe(0);
  });
  it("no use → no suggestion", () => {
    expect(suggestReorder({ usedPerDay: null, available: 5, leadTimeDays: 3, coverDays: 30, today: "2026-10-24" })).toBeNull();
  });
  it("fractional use rounds the need up", () => {
    expect(suggestReorder({ usedPerDay: 0.5, available: 0, leadTimeDays: 3, coverDays: 30, today: "2026-10-24" })?.suggested).toBe(17);
  });
});

describe("rankOf", () => {
  it("NEEDS_FILL (most owed first) → OUT → LOW (fewest days first) → OK", () => {
    const rows = [
      { status: "OK", owed: 0, daysLeft: 90, name: "b", sku: "B" },
      { status: "LOW", owed: 0, daysLeft: 9, name: "a", sku: "A" },
      { status: "NEEDS_FILL", owed: 2, daysLeft: null, name: "z", sku: "Z" },
      { status: "LOW", owed: 0, daysLeft: 3, name: "c", sku: "C" },
      { status: "OUT", owed: 0, daysLeft: null, name: "d", sku: "D" },
      { status: "NEEDS_FILL", owed: 23, daysLeft: 11, name: "y", sku: "Y" },
    ] as const;
    expect([...rows].sort((x, y) => rankOf(x).localeCompare(rankOf(y))).map((r) => r.sku)).toEqual(["Y", "Z", "D", "C", "A", "B"]);
  });
});

describe("limitingMaterial", () => {
  it("the line that makes the fewest bottles, wastage included", () => {
    const lines = [
      { materialVariantId: "oil", qtyPerUnit: 6, wastagePct: 0 },
      { materialVariantId: "bottle", qtyPerUnit: 1, wastagePct: 0 },
      { materialVariantId: "box", qtyPerUnit: 1, wastagePct: 10 },
    ];
    expect(limitingMaterial(lines, new Map([["oil", 250], ["bottle", 166], ["box", 500]]))).toBe("oil"); // 41 vs 166 vs 454
    expect(limitingMaterial(lines, new Map([["oil", 6000], ["bottle", 166], ["box", 150]]))).toBe("box"); // 1000 vs 166 vs 136
    expect(limitingMaterial([], new Map())).toBeNull();
  });
});
