import { describe, expect, it } from "vitest";
import { composePeriodReport, PERIOD_SMS_MAX } from "./period-report";
import type { ScorecardFigure } from "./scorecard.service";

const f = (key: string, unit: ScorecardFigure["unit"], value: number | null, extra: Partial<ScorecardFigure> = {}): ScorecardFigure => ({
  key,
  label: key,
  unit,
  value,
  previous: null,
  target: null,
  status: "neutral",
  rule: "",
  ...extra,
});

const FIGURES: ScorecardFigure[] = [
  f("netSales", "money", 184500, { target: 300000, status: "bad" }),
  f("orders", "count", 241, { target: 400, status: "good" }),
  f("aov", "money", 766),
  f("deliverySuccess", "ratio", 0.836),
  f("returnRate", "ratio", 0.021),
  f("cancelledOrders", "count", 34),
  f("profit", "money", 31200),
  f("adSpend", "money", 16400),
  f("salesPerAdTaka", "times", 11.25),
];

const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);

describe("composePeriodReport", () => {
  it("the weekly text reads the month so far against its targets, plain ASCII so it stays a normal SMS", () => {
    const text = composePeriodReport({ storeName: "Asif Zone", currency: "BDT", kind: "week", periodLabel: "Nov so far (day 18/30)", figures: FIGURES });
    expect(text).toBe("Asif Zone - Nov so far (day 18/30): Sales BDT 184,500 of 300,000 (behind), Orders 241 of 400, Delivered 83.6%, Returns 2.1%, Profit BDT 31,200, Ads BDT 16,400 (11.3x sales)");
    expect(ascii(text)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(PERIOD_SMS_MAX);
  });

  it("the monthly text closes a month and leaves out what the reader can't see", () => {
    const text = composePeriodReport({ storeName: "Asif Zone", currency: "BDT", kind: "month", periodLabel: "October", figures: FIGURES.slice(0, 6) });
    expect(text).toBe("Asif Zone - October: Sales BDT 184,500 of 300,000 (missed), Orders 241 of 400, Delivered 83.6%, Returns 2.1%");
  });

  it("shows a loss as a loss and skips figures with no value", () => {
    const text = composePeriodReport({
      storeName: "Shop",
      currency: "BDT",
      kind: "month",
      periodLabel: "June",
      figures: [f("netSales", "money", 1000), f("orders", "count", 3), f("deliverySuccess", "ratio", null), f("returnRate", "ratio", 0), f("profit", "money", -2500)],
    });
    expect(text).toBe("Shop - June: Sales BDT 1,000, Orders 3, Returns 0.0%, Loss BDT 2,500");
  });

  it("a very long store name never pushes the text past two SMS", () => {
    const text = composePeriodReport({ storeName: "A".repeat(200), currency: "BDT", kind: "week", periodLabel: "Nov so far (day 18/30)", figures: FIGURES });
    expect(text.length).toBeLessThanOrEqual(PERIOD_SMS_MAX);
  });
});
