/**
 * Business time — the ONE way a metric resolves "today", "last 30 days", "this month" or a custom date range
 * (docs/METRICS_REGISTRY.md §1). Pure: no clock (now is an argument), no I/O. Timezone arithmetic uses Intl, so it is
 * DST-correct for any IANA zone (the offset is computed for each date, never assumed).
 *
 * Storage is UTC. A business date is the calendar date in the store timezone. A range is half-open [startUtc, endUtc)
 * whose `from`/`to` business dates are both inclusive.
 */

export const METRIC_PRESETS = [
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "last_365_days",
  "this_week",
  "this_month",
  "last_month",
  "this_year",
  "lifetime",
] as const;
export type MetricPreset = (typeof METRIC_PRESETS)[number];

export type BucketGrain = "day" | "month" | "year";

export interface BusinessRange {
  /** Inclusive first business date, YYYY-MM-DD. */
  from: string;
  /** Inclusive last business date, YYYY-MM-DD. */
  to: string;
  /** Local 00:00 of `from`, as a UTC instant. */
  startUtc: Date;
  /** Local 00:00 of the day after `to`, as a UTC instant (exclusive bound). */
  endUtc: Date;
  timezone: string;
  preset: MetricPreset | null;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LIFETIME_FROM = "1970-01-01";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

function zonedParts(instant: Date, tz: string) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (ms) of `tz` from UTC at `instant`: local wall clock − UTC. */
function offsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** The business date (YYYY-MM-DD) of an instant in the store timezone. */
export function businessDate(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

export function parseBusinessDate(date: string): { year: number; month: number; day: number } | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Calendar arithmetic on business dates (timezone-free). */
export function addDays(date: string, days: number): string {
  const p = parseBusinessDate(date);
  if (!p) throw new RangeError(`Invalid business date ${date}`);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Local 00:00 of a business date in `tz`, as a UTC instant. Handles DST: the offset is taken at that local time. */
export function businessDayStartUtc(date: string, tz: string): Date {
  const p = parseBusinessDate(date);
  if (!p) throw new RangeError(`Invalid business date ${date}`);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day);
  let guess = localAsUtc - offsetMs(new Date(localAsUtc), tz);
  // Re-evaluate once at the candidate instant: across a DST change the offset at local midnight differs from the one at
  // UTC midnight of the same date.
  const corrected = localAsUtc - offsetMs(new Date(guess), tz);
  if (corrected !== guess) guess = corrected;
  return new Date(guess);
}

/** The bucket key of an instant: YYYY-MM-DD (day), YYYY-MM (month) or YYYY (year), in the store timezone. */
export function bucketKey(instant: Date, tz: string, grain: BucketGrain): string {
  const d = businessDate(instant, tz);
  return grain === "day" ? d : grain === "month" ? d.slice(0, 7) : d.slice(0, 4);
}

/** Every bucket key of a range, in order (for zero-filled series). */
export function enumerateBuckets(range: BusinessRange, grain: BucketGrain, max = 400): string[] {
  const keys: string[] = [];
  let cursor = range.from;
  while (cursor <= range.to) {
    const key = grain === "day" ? cursor : grain === "month" ? cursor.slice(0, 7) : cursor.slice(0, 4);
    if (keys[keys.length - 1] !== key) keys.push(key);
    if (keys.length > max) throw new RangeError(`Too many ${grain} buckets for this range (max ${max})`);
    cursor = grain === "day" ? addDays(cursor, 1) : grain === "month" ? firstOfNextMonth(cursor) : `${Number(cursor.slice(0, 4)) + 1}-01-01`;
  }
  return keys;
}

function firstOfNextMonth(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${pad(y, 4)}-${pad(m + 1)}-01`;
}

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function lastOfMonth(date: string): string {
  return addDays(firstOfNextMonth(date), -1);
}

export interface RangeInput {
  preset?: MetricPreset;
  from?: string;
  to?: string;
}

export class InvalidRangeError extends Error {}

/** Resolves a preset or an explicit from/to (business dates, inclusive) into a half-open UTC range in `tz`. */
export function resolveBusinessRange(input: RangeInput, tz: string, now: Date): BusinessRange {
  if (!isValidTimeZone(tz)) throw new InvalidRangeError(`Unknown timezone ${tz}`);
  const today = businessDate(now, tz);
  let from: string;
  let to: string;
  let preset: MetricPreset | null = null;

  if (input.from || input.to) {
    if (!input.from || !input.to) throw new InvalidRangeError("Both from and to are required for a custom range");
    if (!parseBusinessDate(input.from) || !parseBusinessDate(input.to)) throw new InvalidRangeError("Dates must be YYYY-MM-DD");
    if (input.from > input.to) throw new InvalidRangeError("from must not be after to");
    from = input.from;
    to = input.to;
  } else {
    preset = input.preset ?? "last_30_days";
    switch (preset) {
      case "today":
        from = to = today;
        break;
      case "yesterday":
        from = to = addDays(today, -1);
        break;
      case "last_7_days":
      case "last_30_days":
      case "last_90_days":
      case "last_365_days": {
        const n = Number(preset.split("_")[1]);
        from = addDays(today, -(n - 1));
        to = today;
        break;
      }
      case "this_week": {
        // ISO week: Monday is the first business day of the week.
        const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
        from = addDays(today, -((dow + 6) % 7));
        to = today;
        break;
      }
      case "this_month":
        from = firstOfMonth(today);
        to = today;
        break;
      case "last_month": {
        const lastDayPrev = addDays(firstOfMonth(today), -1);
        from = firstOfMonth(lastDayPrev);
        to = lastOfMonth(lastDayPrev);
        break;
      }
      case "this_year":
        from = `${today.slice(0, 4)}-01-01`;
        to = today;
        break;
      case "lifetime":
        from = LIFETIME_FROM;
        to = today;
        break;
      default:
        throw new InvalidRangeError(`Unknown preset ${String(preset)}`);
    }
  }
  return { from, to, startUtc: businessDayStartUtc(from, tz), endUtc: businessDayStartUtc(addDays(to, 1), tz), timezone: tz, preset };
}

/** Is an instant inside a half-open range? */
export function inRange(instant: Date | null | undefined, range: Pick<BusinessRange, "startUtc" | "endUtc">): instant is Date {
  if (!instant) return false;
  const t = instant.getTime();
  return t >= range.startUtc.getTime() && t < range.endUtc.getTime();
}

/** The range immediately before `range`, of the same number of business days (for period-over-period deltas). */
export function previousRange(range: BusinessRange): BusinessRange {
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
  const to = addDays(range.from, -1);
  const from = addDays(to, -(days - 1));
  return { ...range, from, to, preset: null, startUtc: businessDayStartUtc(from, range.timezone), endUtc: range.startUtc };
}

/** Local hour (0–23) and day of week (0 = Sunday) of an instant in the store timezone. */
export function localClock(instant: Date, tz: string): { hour: number; dow: number } {
  const p = zonedParts(instant, tz);
  return { hour: p.hour, dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}
