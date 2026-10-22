/**
 * Anomalies and the daily brief (docs/METRICS_REGISTRY.md §4.9). A business day's counts — the §4.5 ops events and
 * website visits (all, and per §4.6 channel) — against the same weekday over the previous four weeks; a day in progress
 * is compared "by this time". The brief reads the day's pulse, sales and best channel, the queues now and the anomalies.
 */
import { addDays, businessDate, businessDayStartUtc, resolveBusinessRange } from "@clothing-brand/shared";
import { cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { notify } from "../../lib/notify";
import { computeMetrics } from "../../domain/metrics/metrics.service";
import { storeContext } from "../../domain/metrics/store-time";
import { detectAnomaly, type Anomaly } from "./anomalies";
import { composeBrief, type DailyBrief } from "./daily-brief";
import { comparisonDates, countOps, type OpsCountKey } from "./ops-pulse";
import { getOpsPulse, loadOpsEvents } from "./ops-pulse.service";
import { getChannelPerformance, sessionStarts } from "./traffic.service";

const CACHE_TTL_SECONDS = 60;
/** A channel needs this many visits on a usual day before its swings are worth reporting. */
const MIN_CHANNEL_VISITS = 10;

const OPS_CHECKS: Array<[OpsCountKey, string]> = [
  ["placed", "Orders"],
  ["confirmed", "Confirmed orders"],
  ["booked", "Parcels sent"],
  ["delivered", "Deliveries"],
  ["returned", "Refused parcels"],
  ["cancelled", "Cancellations"],
];

function parseDate(date: string | undefined, today: string): string {
  if (date === undefined) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw AppError.badRequest("date must be YYYY-MM-DD", { code: "INVALID_RANGE" });
  if (date > today) throw AppError.badRequest("date can't be in the future", { code: "INVALID_RANGE" });
  return date;
}

export interface AnomalyReport {
  date: string;
  partialDay: boolean;
  asOf: string | null;
  anomalies: Anomaly[];
}

/** What's unusual about a business day (default today, compared by this time), most unusual first. */
export async function getAnomalies(dateInput?: string, now: Date = new Date()): Promise<AnomalyReport> {
  const { timezone, currency } = await storeContext();
  const today = businessDate(now, timezone);
  const date = parseDate(dateInput, today);
  const partialDay = date === today;
  const cutoffMs = partialDay ? now.getTime() - businessDayStartUtc(date, timezone).getTime() : undefined;
  const key = `analytics:v1:anomalies:${timezone}:${date}:${partialDay ? Math.floor(now.getTime() / 60_000) : "day"}`;
  const hit = await cacheGet<AnomalyReport>(key);
  if (hit) return hit;

  const window = resolveBusinessRange({ from: addDays(date, -28), to: date }, timezone, now);
  const baselineDates = comparisonDates(date).sameWeekday;
  const [events, visits] = await Promise.all([loadOpsEvents(window, currency), sessionStarts(window)]);
  const counts = countOps(events, [date, ...baselineDates], timezone, cutoffMs);

  const anomalies: Anomaly[] = [];
  for (const [k, label] of OPS_CHECKS) {
    const a = detectAnomaly({ key: k, label, value: counts[date]![k], baseline: baselineDates.map((d) => counts[d]![k]) });
    if (a) anomalies.push(a);
  }

  // Visits: all, and per channel — cut at the same time of day, bucketed by business date.
  const dayIndex = new Map([date, ...baselineDates].map((d, i) => [d, i]));
  const total = new Array<number>(dayIndex.size).fill(0);
  const byChannel = new Map<string, number[]>();
  for (const v of visits) {
    const d = businessDate(v.at, timezone);
    const i = dayIndex.get(d);
    if (i === undefined) continue;
    if (cutoffMs !== undefined && v.at.getTime() - businessDayStartUtc(d, timezone).getTime() >= cutoffMs) continue;
    total[i]! += 1;
    const arr = byChannel.get(v.channel) ?? new Array<number>(dayIndex.size).fill(0);
    arr[i]! += 1;
    byChannel.set(v.channel, arr);
  }
  const visitsAnomaly = detectAnomaly({ key: "sessions", label: "Website visits", value: total[0]!, baseline: total.slice(1) });
  if (visitsAnomaly) anomalies.push(visitsAnomaly);
  for (const [channel, arr] of byChannel) {
    const base = arr.slice(1);
    if (base.reduce((s, v) => s + v, 0) / base.length < MIN_CHANNEL_VISITS) continue;
    const a = detectAnomaly({ key: `sessions:${channel}`, label: `Visits from ${channel}`, value: arr[0]!, baseline: base });
    if (a) anomalies.push(a);
  }

  const report: AnomalyReport = { date, partialDay, asOf: partialDay ? now.toISOString() : null, anomalies: anomalies.sort((a, b) => b.score - a.score) };
  await cacheSet(key, report, CACHE_TTL_SECONDS);
  return report;
}

export interface DailyBriefReport extends DailyBrief {
  date: string;
  partialDay: boolean;
}

/** The brief for a business day — by default yesterday, the last complete day. */
export async function getDailyBrief(dateInput?: string, now: Date = new Date()): Promise<DailyBriefReport> {
  const { timezone, currency } = await storeContext();
  const today = businessDate(now, timezone);
  const date = parseDate(dateInput ?? addDays(today, -1), today);
  const dayStart = businessDayStartUtc(date, timezone);
  const [pulse, metrics, channels, anomalies] = await Promise.all([
    getOpsPulse(date, now),
    computeMetrics({ metrics: ["realised_net_sales", "payments_received"], range: { from: date, to: date } }, now),
    getChannelPerformance(undefined, dayStart, dayStart),
    getAnomalies(date, now),
  ]);
  const top = channels.channels.filter((c) => c.channel !== null && c.orders > 0).sort((a, b) => b.orders - a.orders)[0];
  const brief = composeBrief({
    date,
    currency,
    day: pulse.day,
    typical: pulse.typical,
    netSales: metrics.metrics.realised_net_sales?.value ?? 0,
    cashIn: metrics.metrics.payments_received?.value ?? 0,
    topChannel: top ? { label: top.label, orders: top.orders, conversionRate: top.conversionRate } : null,
    queues: pulse.queues,
    anomalies: anomalies.anomalies,
  });
  return { date, partialDay: date === today, ...brief };
}

/** The morning notification: yesterday's brief in the admin bell, linking to the daily pulse. */
export async function sendMorningBrief(now: Date = new Date()): Promise<DailyBriefReport> {
  const brief = await getDailyBrief(undefined, now);
  notify({
    type: "analytics.daily_brief",
    title: brief.headline,
    body: [...brief.lines, ...(brief.watch.length ? [`Watch: ${brief.watch.join("; ")}`] : [])].join("\n"),
    link: "/admin/analytics/operations",
  });
  return brief;
}
