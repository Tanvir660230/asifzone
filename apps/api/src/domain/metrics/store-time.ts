/**
 * Store business time for the API (docs/METRICS_REGISTRY.md §1): the store timezone comes from the commerce-settings
 * service (Phase 7 — the one resolution path; StoreSetting is its storage), "now" from
 * the application clock, and every raw-SQL comparison against a timestamp column goes through `utcInstant`.
 *
 * Why `utcInstant`: columns are naive `timestamp(3)` holding UTC wall-clock (Prisma), the DB session runs in the
 * store's zone, and a bound JS Date arrives as `timestamptz` — comparing the two silently shifts every window by the
 * zone offset (measured: PHASE_5_METRICS_AUDIT §2). Converting the bound instant to naive UTC makes both sides agree.
 */
import { Prisma } from "@prisma/client";
import { addDays, businessDate, resolveBusinessRange, type BusinessRange, type RangeInput } from "@clothing-brand/shared";
import { getCommerceSettings } from "../config/commerce-settings";

export interface StoreContext {
  timezone: string;
  currency: string;
}

export async function storeContext(): Promise<StoreContext> {
  return getCommerceSettings();
}

/** A bound instant as naive UTC — the only way metrics/analytics SQL compares with a timestamp column. */
export function utcInstant(instant: Date): Prisma.Sql {
  return Prisma.sql`(${instant}::timestamptz AT TIME ZONE 'UTC')`;
}

/** A timestamp column expressed in the store's local wall clock (for hour-of-day / day-of-week breakdowns). */
export function localTime(column: string, timezone: string): Prisma.Sql {
  return Prisma.sql`((${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})`;
}

/** Resolves a preset / custom range in the store timezone at the current instant. */
export async function resolveStoreRange(input: RangeInput, now: Date = new Date()): Promise<BusinessRange> {
  const { timezone } = await storeContext();
  return resolveBusinessRange(input, timezone, now);
}

/** The legacy dashboard window parameters — `days` back (undefined = lifetime), or a picker's absolute dateFrom/dateTo —
 * resolved as business days in the store timezone: "last N days" = N business days ending today (today included);
 * picker instants are read as the business dates they fall on (both inclusive). */
export async function resolveLegacyWindow(days: number | undefined, dateFrom?: Date, dateTo?: Date, now: Date = new Date()): Promise<BusinessRange> {
  const { timezone } = await storeContext();
  const today = businessDate(now, timezone);
  if (dateFrom || dateTo) {
    const from = dateFrom ? businessDate(dateFrom, timezone) : "1970-01-01";
    const to = dateTo ? businessDate(dateTo, timezone) : today;
    return resolveBusinessRange({ from: from <= to ? from : to, to }, timezone, now);
  }
  if (days === undefined) return resolveBusinessRange({ preset: "lifetime" }, timezone, now);
  const n = Math.max(1, Math.floor(days));
  return resolveBusinessRange({ from: addDays(today, -(n - 1)), to: today }, timezone, now);
}
