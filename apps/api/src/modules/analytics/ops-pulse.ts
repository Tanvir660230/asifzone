/**
 * Daily pulse (docs/SMART_ANALYTICS_PLAN.md phase A, docs/METRICS_REGISTRY.md §4.5): what the shop did on a business
 * day — orders in, confirmed, cancelled, parcels booked with the courier, shipped, delivered, returned — and how that
 * compares with other days. Pure: the loader (ops-pulse.service.ts) turns rows into events; everything here is counting.
 *
 * An event is the FIRST time an order reached that point (first CONFIRMED entry, first booking…), so an order that
 * bounces between statuses is counted once, on the day it first got there. Days are business dates in the store
 * timezone.
 */
import { addDays, businessDate, businessDayStartUtc, localClock } from "@clothing-brand/shared";

export type OrderSource = "web" | "landing" | "phone" | "other";

export type OpsEventKind = "placed" | "confirmed" | "cancelled" | "booked" | "shipped" | "delivered" | "partially_delivered" | "returned";

export interface OpsEvent {
  kind: OpsEventKind;
  at: Date;
  orderId: string;
  /** placed: where the order came from. */
  source?: OrderSource;
  /** booked: the cash the courier is to collect on the parcel (minor units; 0 for prepaid). */
  codValue?: number;
}

export const OPS_COUNT_KEYS = [
  "placed",
  "placed_web",
  "placed_landing",
  "placed_phone",
  "confirmed",
  "cancelled",
  "booked",
  "booked_cod_value",
  "shipped",
  "delivered",
  "partially_delivered",
  "returned",
] as const;
export type OpsCountKey = (typeof OPS_COUNT_KEYS)[number];
export type OpsCounts = Record<OpsCountKey, number>;

const emptyCounts = (): OpsCounts => Object.fromEntries(OPS_COUNT_KEYS.map((k) => [k, 0])) as OpsCounts;

function add(c: OpsCounts, e: OpsEvent) {
  c[e.kind] += 1;
  if (e.kind === "placed" && e.source && e.source !== "other") c[`placed_${e.source}`] += 1;
  if (e.kind === "booked") c.booked_cod_value += e.codValue ?? 0;
}

/**
 * Counts per business date. `cutoffMs` (milliseconds after local midnight) keeps only events before that time of day —
 * so a day still in progress can be compared with other days "by this time".
 */
export function countOps(events: OpsEvent[], dates: string[], tz: string, cutoffMs?: number): Record<string, OpsCounts> {
  const out: Record<string, OpsCounts> = Object.fromEntries(dates.map((d) => [d, emptyCounts()]));
  for (const e of events) {
    const d = businessDate(e.at, tz);
    const c = out[d];
    if (!c) continue;
    if (cutoffMs !== undefined && e.at.getTime() - businessDayStartUtc(d, tz).getTime() >= cutoffMs) continue;
    add(c, e);
  }
  return out;
}

/** The dates a pulse for `date` compares against: yesterday, and the same weekday 1–4 weeks back. */
export function comparisonDates(date: string): { yesterday: string; lastWeek: string; sameWeekday: string[] } {
  return { yesterday: addDays(date, -1), lastWeek: addDays(date, -7), sameWeekday: [7, 14, 21, 28].map((n) => addDays(date, -n)) };
}

export interface OpsComparison {
  day: OpsCounts;
  yesterday: OpsCounts;
  lastWeek: OpsCounts;
  /** Mean of the same weekday over the previous four weeks (fractional). */
  typical: OpsCounts;
}

/** The day against yesterday, the same weekday last week and the 4-week same-weekday average (all with the same cutoff). */
export function compareOps(events: OpsEvent[], date: string, tz: string, cutoffMs?: number): OpsComparison {
  const cmp = comparisonDates(date);
  const days = countOps(events, [date, cmp.yesterday, ...cmp.sameWeekday], tz, cutoffMs);
  const typical = emptyCounts();
  for (const k of OPS_COUNT_KEYS) typical[k] = cmp.sameWeekday.reduce((s, d) => s + days[d]![k], 0) / cmp.sameWeekday.length;
  return { day: days[date]!, yesterday: days[cmp.yesterday]!, lastWeek: days[cmp.lastWeek]!, typical };
}

/** Orders placed per local hour on `date`, with the same-weekday 4-week average per hour. */
export function hourlyPlaced(events: OpsEvent[], date: string, tz: string): Array<{ hour: number; day: number; typical: number }> {
  const others = new Set(comparisonDates(date).sameWeekday);
  const day = new Array<number>(24).fill(0);
  const past = new Array<number>(24).fill(0);
  for (const e of events) {
    if (e.kind !== "placed") continue;
    const d = businessDate(e.at, tz);
    const { hour } = localClock(e.at, tz);
    if (d === date) day[hour]! += 1;
    else if (others.has(d)) past[hour]! += 1;
  }
  return day.map((n, hour) => ({ hour, day: n, typical: past[hour]! / others.size }));
}
