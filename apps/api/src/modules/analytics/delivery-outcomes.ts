/**
 * Delivery outcomes (docs/METRICS_REGISTRY.md §4.7): of the parcels that FINISHED with the courier in a period —
 * delivered in full, delivered in part, or refused / returned — how many succeeded, and where the refusals concentrate
 * (district, product, payment method, order value, new vs returning customer, channel). Pure; the loader is
 * delivery-outcomes.service.ts. Money is minor units.
 */
import { addDays, BD_DIALLING_CODE, businessDate, currencySymbol, localClock } from "@clothing-brand/shared";

export type ParcelOutcome = "delivered" | "partial" | "refused";

export interface Parcel {
  orderId: string;
  bookedAt: Date;
  /** When the parcel finished: first DELIVERED / PARTIALLY_DELIVERED, or the refusal. */
  endedAt: Date;
  outcome: ParcelOutcome;
  district: string;
  division: string;
  paymentMethod: string;
  /** Order total (minor). */
  value: number;
  /** What the rider was to collect at booking (minor; 0 for prepaid). */
  codValue: number;
  phone: string;
  customerName: string;
  /** The same phone had placed an order before this one. */
  repeatCustomer: boolean;
  /** Credited traffic channel label (§4.6), or null for orders without a website visit. */
  channel: string | null;
  products: Array<{ id: string; name: string }>;
}

export interface OutcomeCounts {
  parcels: number;
  delivered: number;
  partial: number;
  refused: number;
  /** delivered ÷ parcels */
  successRate: number;
  /** refused ÷ parcels */
  refusalRate: number;
}

const DAY_MS = 86_400_000;

function counts(list: Parcel[]): OutcomeCounts {
  const delivered = list.filter((p) => p.outcome === "delivered").length;
  const partial = list.filter((p) => p.outcome === "partial").length;
  const refused = list.filter((p) => p.outcome === "refused").length;
  const parcels = list.length;
  return { parcels, delivered, partial, refused, successRate: parcels ? delivered / parcels : 0, refusalRate: parcels ? refused / parcels : 0 };
}

function avgDaysToDeliver(list: Parcel[]): number | null {
  const done = list.filter((p) => p.outcome === "delivered");
  if (!done.length) return null;
  return done.reduce((s, p) => s + (p.endedAt.getTime() - p.bookedAt.getTime()) / DAY_MS, 0) / done.length;
}

export interface OutcomeTotals extends OutcomeCounts {
  /** COD value of refused parcels — money that came back instead of being collected. */
  refusedCodValue: number;
  /** Booking → delivered, delivered parcels only (days). */
  avgDaysToDeliver: number | null;
}

export function outcomeTotals(list: Parcel[]): OutcomeTotals {
  return { ...counts(list), refusedCodValue: list.filter((p) => p.outcome === "refused").reduce((s, p) => s + p.codValue, 0), avgDaysToDeliver: avgDaysToDeliver(list) };
}

export interface BreakdownRow extends OutcomeCounts {
  key: string;
  avgDaysToDeliver: number | null;
}

/**
 * Outcomes grouped by `keys(parcel)` — a parcel may sit in several groups (one per product). Groups below `minParcels`
 * are dropped (a 1-of-1 refusal says nothing). Largest groups first.
 */
export function breakdown(list: Parcel[], keys: (p: Parcel) => Array<string | null>, opts: { minParcels?: number; limit?: number } = {}): BreakdownRow[] {
  const groups = new Map<string, Parcel[]>();
  for (const p of list) {
    for (const k of new Set(keys(p))) {
      if (k === null) continue;
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
  }
  const rows = [...groups.entries()]
    .map(([key, ps]) => ({ key, ...counts(ps), avgDaysToDeliver: avgDaysToDeliver(ps) }))
    .filter((r) => r.parcels >= (opts.minParcels ?? 1))
    .sort((a, b) => b.parcels - a.parcels || b.refusalRate - a.refusalRate || a.key.localeCompare(b.key));
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

/** Order value bands (minor units): upper limits, then the open-ended top band. */
const BAND_LIMITS = [50_000, 100_000, 200_000] as const;

/** The bands' labels, lowest first, in the store currency ("Under 500" … "2,000+", with its symbol). */
export function valueBands(currency: string): string[] {
  const s = currencySymbol(currency);
  return [`Under ${s}500`, `${s}500–999`, `${s}1,000–1,999`, `${s}2,000+`];
}

/** Order value band (minor units) — its label from valueBands. */
export function valueBand(value: number, currency: string): string {
  const labels = valueBands(currency);
  const i = BAND_LIMITS.findIndex((limit) => value < limit);
  return labels[i === -1 ? BAND_LIMITS.length : i]!;
}

/** Bangladeshi mobile numbers in one spelling: 01XXXXXXXXX (drops +88 / 88 and spaces/dashes). */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith(BD_DIALLING_CODE) ? digits.slice(2) : digits.startsWith(BD_DIALLING_CODE.slice(0, 2)) && digits.length === 13 ? digits.slice(2) : digits;
}

export interface RepeatRefuser {
  phone: string;
  name: string;
  refused: number;
  delivered: number;
  partial: number;
  refusedCodValue: number;
  lastOrderId: string;
}

/** Phones that refused two or more of the parcels, most refusals first. */
export function repeatRefusers(list: Parcel[], limit = 20): RepeatRefuser[] {
  const byPhone = new Map<string, Parcel[]>();
  for (const p of list) {
    const k = normalizePhone(p.phone);
    byPhone.set(k, [...(byPhone.get(k) ?? []), p]);
  }
  return [...byPhone.entries()]
    .map(([phone, ps]) => {
      const sorted = [...ps].sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime());
      return {
        phone,
        name: sorted[0]!.customerName,
        refused: ps.filter((p) => p.outcome === "refused").length,
        delivered: ps.filter((p) => p.outcome === "delivered").length,
        partial: ps.filter((p) => p.outcome === "partial").length,
        refusedCodValue: ps.filter((p) => p.outcome === "refused").reduce((s, p) => s + p.codValue, 0),
        lastOrderId: sorted[0]!.orderId,
      };
    })
    .filter((r) => r.refused >= 2)
    .sort((a, b) => b.refused - a.refused || b.refusedCodValue - a.refusedCodValue)
    .slice(0, limit);
}

/** Monday (business date) of the week an instant falls in. */
function weekOf(instant: Date, tz: string): string {
  const date = businessDate(instant, tz);
  const dow = localClock(instant, tz).dow; // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export function weeklyTrend(list: Parcel[], tz: string): Array<{ week: string } & Omit<OutcomeCounts, "refusalRate">> {
  const weeks = new Map<string, Parcel[]>();
  for (const p of list) {
    const w = weekOf(p.endedAt, tz);
    weeks.set(w, [...(weeks.get(w) ?? []), p]);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, ps]) => {
      const { refusalRate: _r, ...c } = counts(ps);
      return { week, ...c };
    });
}
