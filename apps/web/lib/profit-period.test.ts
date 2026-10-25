import { describe, expect, it } from "vitest";
import { bucketDays, defaultGrain, presetRange, priorLabel, weekStart } from "./profit-period";

const day = (date: string, sales: number, profit: number) => ({ date, orders: 1, sales, goods: 0, stockCorrections: 0, packaging: 0, delivery: 0, paymentFees: 0, ads: 0, running: 0, salesProfit: profit, profit });

describe("profit periods", () => {
  it("presets end on the store's today", () => {
    expect(presetRange("today", "2026-10-22")).toEqual({ from: "2026-10-22", to: "2026-10-22" });
    expect(presetRange("yesterday", "2026-10-01")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(presetRange("7d", "2026-10-22")).toEqual({ from: "2026-10-16", to: "2026-10-22" });
    expect(presetRange("month", "2026-10-22")).toEqual({ from: "2026-10-01", to: "2026-10-22" });
    expect(presetRange("lastMonth", "2026-03-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("90d", "2026-10-22")).toEqual({ from: "2026-07-25", to: "2026-10-22" });
  });

  it("groups by day up to six weeks, then weeks, then months", () => {
    expect(defaultGrain(30)).toBe("day");
    expect(defaultGrain(90)).toBe("week");
    expect(defaultGrain(366)).toBe("month");
  });

  it("weeks start on Saturday and buckets add up", () => {
    expect(weekStart("2026-10-24")).toBe("2026-10-24"); // a Saturday
    expect(weekStart("2026-10-23")).toBe("2026-10-17"); // Friday → the Saturday before
    const b = bucketDays([day("2026-10-23", 100, 10), day("2026-10-24", 50.5, -5.25), day("2026-10-25", 20, 2)], "week");
    expect(b.map((x) => [x.key, x.from, x.to, x.sales, x.profit])).toEqual([["2026-10-17", "2026-10-23", "2026-10-23", 100, 10], ["2026-10-24", "2026-10-24", "2026-10-25", 70.5, -3.25]]);
    expect(bucketDays([day("2026-09-30", 1, 1), day("2026-10-01", 2, 2)], "month").map((x) => x.key)).toEqual(["2026-09", "2026-10"]);
  });

  it("names the period it compares with", () => {
    expect(priorLabel("today", 1)).toBe("yesterday");
    expect(priorLabel("7d", 7)).toBe("the 7 days before");
  });
});
