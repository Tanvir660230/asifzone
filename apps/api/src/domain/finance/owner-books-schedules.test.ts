import { describe, it, expect } from "vitest";
import { plannedSpend } from "./ads.service";
import { prepaidSchedule } from "./prepaid.service";
import { packagingFor } from "./packaging.service";

// Owner's books §5–§6: how a campaign's budget is spread over its days, how a prepaid cost is shared over its months, and
// what packaging a parcel uses. Pure, minor units.

describe("planned ad spend", () => {
  it("a daily budget books every day from the start up to the day given (never past the end)", () => {
    const p = plannedSpend({ startDate: "2026-10-01", endDate: "2026-10-03", budgetType: "DAILY", budget: 50000 }, "2026-10-10");
    expect([...p]).toEqual([["2026-10-01", 50000], ["2026-10-02", 50000], ["2026-10-03", 50000]]);
    expect(plannedSpend({ startDate: "2026-10-01", endDate: null, budgetType: "DAILY", budget: 50000 }, "2026-10-02").size).toBe(2);
  });
  it("a lifetime budget is spread evenly, the last day taking the rounding", () => {
    const p = plannedSpend({ startDate: "2026-10-01", endDate: "2026-10-03", budgetType: "LIFETIME", budget: 100000 }, "2026-10-31");
    expect([...p.values()]).toEqual([33333, 33333, 33334]);
    expect([...p.values()].reduce((s, x) => s + x, 0)).toBe(100000);
    // part-way through only the days that passed
    expect([...plannedSpend({ startDate: "2026-10-01", endDate: "2026-10-03", budgetType: "LIFETIME", budget: 100000 }, "2026-10-02").values()]).toEqual([33333, 33333]);
  });
  it("no budget, or a start after the day given → nothing planned", () => {
    expect(plannedSpend({ startDate: "2026-10-01", endDate: null, budgetType: null, budget: null }, "2026-10-05").size).toBe(0);
    expect(plannedSpend({ startDate: "2026-10-10", endDate: null, budgetType: "DAILY", budget: 1 }, "2026-10-05").size).toBe(0);
  });
});

describe("prepaid schedule", () => {
  it("a year of hosting from mid-month: shares by days of service, adding up to the amount exactly", () => {
    const s = prepaidSchedule(1200000, "2026-10-15", "2027-10-14");
    expect(s).toHaveLength(13);
    expect(s[0]).toMatchObject({ period: "2026-10", date: "2026-10-31", days: 17 });
    expect(s[12]).toMatchObject({ period: "2027-10", date: "2027-10-14", days: 14 });
    expect(s.reduce((t, x) => t + x.amount, 0)).toBe(1200000);
  });
  it("one month exactly, and a single day", () => {
    expect(prepaidSchedule(3000, "2026-11-01", "2026-11-30")).toEqual([{ period: "2026-11", date: "2026-11-30", days: 30, amount: 3000 }]);
    expect(prepaidSchedule(500, "2026-11-05", "2026-11-05")).toEqual([{ period: "2026-11", date: "2026-11-05", days: 1, amount: 500 }]);
  });
});

describe("packaging per parcel", () => {
  const lines = [
    { variantId: "cap-m", productId: "cap", categoryId: "caps", quantity: 2 },
    { variantId: "attar-6", productId: "attar", categoryId: "attar", quantity: 1 },
  ];
  const rule = (o: Partial<Parameters<typeof packagingFor>[1][number]>) => ({ id: "r", scope: "EVERY_PARCEL" as const, scopeId: null, materialVariantId: "poly", quantity: 1, per: "PARCEL" as const, createdAt: new Date(), ...o });
  it("every parcel: one poly bag; per unit of a category: a cap box each", () => {
    const need = packagingFor(lines, [rule({}), rule({ scope: "CATEGORY", scopeId: "caps", materialVariantId: "cap-box", per: "UNIT" })]);
    expect([...need]).toEqual([["poly", 1], ["cap-box", 2]]);
  });
  it("a product or variant rule only for parcels that hold it; quantities add up per material", () => {
    expect([...packagingFor(lines, [rule({ scope: "PRODUCT", scopeId: "shirt", materialVariantId: "hanger" })])]).toEqual([]);
    expect([...packagingFor(lines, [rule({ scope: "VARIANT", scopeId: "attar-6", materialVariantId: "bubble", quantity: 2 }), rule({ materialVariantId: "bubble" })])]).toEqual([["bubble", 3]]);
  });
});
