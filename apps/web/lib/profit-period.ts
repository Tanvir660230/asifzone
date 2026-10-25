/**
 * The Profit dashboard's periods (docs/FINANCE_PROFIT_DASHBOARD.md): the presets an owner asks for ("today", "last 7
 * days", "3 months" …) as business dates, and the chart's grouping of days into weeks or months. Pure — dates are
 * "YYYY-MM-DD" strings handled in UTC so no viewer timezone can shift a day.
 */
import type { ProfitDay } from "@/lib/api/finance-books";

export const PROFIT_PRESETS = ["today", "yesterday", "7d", "30d", "month", "lastMonth", "90d", "custom"] as const;
export type ProfitPreset = (typeof PROFIT_PRESETS)[number];
export const PRESET_LABEL: Record<ProfitPreset, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "7 days", "30d": "30 days", month: "This month", lastMonth: "Last month", "90d": "3 months", custom: "Custom",
};

export const GRAINS = ["day", "week", "month"] as const;
export type Grain = (typeof GRAINS)[number];

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** The range a preset covers, ending on `today` (the store's business date). */
export function presetRange(preset: Exclude<ProfitPreset, "custom">, today: string): { from: string; to: string } {
  switch (preset) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d": return { from: addDays(today, -6), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "month": return { from: `${today.slice(0, 7)}-01`, to: today };
    case "lastMonth": {
      const end = addDays(`${today.slice(0, 7)}-01`, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    }
    case "90d": return { from: addDays(today, -89), to: today };
  }
}

/** How the chart groups a range by default: days up to ~6 weeks, then weeks, then months past half a year. */
export const defaultGrain = (days: number): Grain => (days <= 45 ? "day" : days <= 186 ? "week" : "month");

export interface ProfitBucket extends Omit<ProfitDay, "date"> { key: string; from: string; to: string }

const FIELDS = ["orders", "sales", "goods", "stockCorrections", "packaging", "delivery", "paymentFees", "ads", "running", "salesProfit", "profit"] as const;

/** The week a date falls in — weeks start on Saturday, the start of the working week in Bangladesh. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  return addDays(date, -((dow + 1) % 7));
}

/** Days folded into day / week / month buckets, oldest first; a bucket's range is clipped to the days given. */
export function bucketDays(days: ProfitDay[], grain: Grain): ProfitBucket[] {
  const out = new Map<string, ProfitBucket>();
  for (const d of days) {
    const key = grain === "day" ? d.date : grain === "week" ? weekStart(d.date) : d.date.slice(0, 7);
    const b = out.get(key) ?? { key, from: d.date, to: d.date, orders: 0, sales: 0, goods: 0, stockCorrections: 0, packaging: 0, delivery: 0, paymentFees: 0, ads: 0, running: 0, salesProfit: 0, profit: 0 };
    for (const f of FIELDS) b[f] = Math.round((b[f] + d[f]) * 100) / 100;
    if (d.date < b.from) b.from = d.date;
    if (d.date > b.to) b.to = d.date;
    out.set(key, b);
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** "yesterday", "the 7 days before" — how the prior period (same length, just before; the API's `prior`) reads after a delta. */
export function priorLabel(preset: ProfitPreset, days: number): string {
  if (preset === "today") return "yesterday";
  return days === 1 ? "the day before" : `the ${days} days before`;
}
