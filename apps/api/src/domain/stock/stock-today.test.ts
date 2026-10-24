import { describe, it, expect } from "vitest";
import { countClasses, cycleCountDue, reorderDue } from "./stock-today.service";

// Smart stock page, task 4 (pure parts): which items to count this week and which to reorder now.

const it_ = (variantId: string, usedValue: number, group = "MATERIAL") => ({ variantId, name: variantId, group, usedValue });

describe("countClasses", () => {
  it("top 80% of use value every 7 days, next 15% every 30, the rest every 90", () => {
    const classes = countClasses([it_("a", 600), it_("b", 200), it_("c", 100), it_("d", 60), it_("e", 40), it_("f", 0)] as never);
    expect(Object.fromEntries(classes)).toEqual({ a: 7, b: 7, c: 30, d: 30, e: 90, f: 90 });
  });
  it("nothing used → everything every 90 days", () => {
    expect([...countClasses([it_("a", 0), it_("b", 0)] as never).values()]).toEqual([90, 90]);
  });
});

describe("cycleCountDue", () => {
  const items = [it_("a", 600), it_("b", 200), it_("c", 100), it_("d", 60), it_("e", 40), it_("attar", 999, "FILL_TO_ORDER")];
  it("due when never counted or last counted longer ago than its interval; attar sizes are not counted", () => {
    const last = new Map([["a", "2026-10-20"], ["b", "2026-10-10"], ["c", "2026-10-01"], ["d", "2026-09-01"], ["e", "2026-10-01"]]);
    // a: 4 days ago (7) → not due; b: 14 (7) → due; c: 23 (30) → not; d: 53 (30) → due; e: 23 (90) → not
    expect(cycleCountDue(items as never, last, "2026-10-24").map((i) => i.variantId)).toEqual(["b", "d"]);
  });
  it("never counted → due, highest value first, at most 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => it_(`m${i}`, 100 - i));
    const due = cycleCountDue(many as never, new Map(), "2026-10-24");
    expect(due).toHaveLength(8);
    expect(due[0]!.variantId).toBe("m0");
  });
});

describe("reorderDue", () => {
  const r = (variantId: string, status: string, orderBy: string | null, suggested: number) => ({ variantId, status, reorder: orderBy ? { orderBy, suggested } : null });
  it("low or out, or to be ordered within 3 days, with something to order — soonest first", () => {
    const rows = [r("ok-far", "OK", "2026-11-20", 50), r("ok-soon", "OK", "2026-10-26", 50), r("low", "LOW", "2026-10-25", 20), r("low-enough", "LOW", "2026-10-24", 0), r("out-no-use", "OUT", null, 0), r("out", "OUT", "2026-10-24", 30)];
    expect(reorderDue(rows as never, "2026-10-24").map((x) => x.variantId)).toEqual(["out", "low", "ok-soon"]);
  });
});
