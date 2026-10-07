/**
 * Financial periods (Phase 1): calendar months of BUSINESS dates (YYYY-MM-DD in the business timezone — the same business
 * day the metrics use, metrics/business-time.ts), grouped into fiscal years that start in a configurable month
 * (Bangladesh: July). Pure.
 */
import { parseBusinessDate } from "../metrics/business-time";

export interface PeriodBounds {
  /** First business date of the month (inclusive). */
  startDate: string;
  /** Last business date of the month (inclusive). */
  endDate: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function isBusinessDate(value: string): boolean {
  const p = parseBusinessDate(value);
  if (!p) return false;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  return d.getUTCFullYear() === p.year && d.getUTCMonth() === p.month - 1 && d.getUTCDate() === p.day;
}

function parts(date: string) {
  const p = parseBusinessDate(date);
  if (!p || !isBusinessDate(date)) throw new RangeError(`Not a business date: ${date}`);
  return p;
}

/** The monthly period containing a business date. */
export function monthPeriod(date: string): PeriodBounds {
  const { year, month } = parts(date);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { startDate: `${year}-${pad(month)}-01`, endDate: `${year}-${pad(month)}-${pad(last)}` };
}

/** The fiscal year a business date belongs to, named by the calendar year it STARTS in (FY 2026 = Jul 2026 – Jun 2027
 * when it starts in July; = the calendar year when it starts in January). */
export function fiscalYearOf(date: string, startMonth: number): number {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new RangeError(`Fiscal year start month must be 1–12, got ${startMonth}`);
  const { year, month } = parts(date);
  return month >= startMonth ? year : year - 1;
}

/** "2026-27" for a July start, "2026" for a January start. */
export function fiscalYearLabel(fiscalYear: number, startMonth: number): string {
  return startMonth === 1 ? String(fiscalYear) : `${fiscalYear}-${String((fiscalYear + 1) % 100).padStart(2, "0")}`;
}

/** Compares two business dates (string order is date order for YYYY-MM-DD). */
export function compareBusinessDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
