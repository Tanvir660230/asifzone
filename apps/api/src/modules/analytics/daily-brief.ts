/**
 * The daily brief (docs/METRICS_REGISTRY.md §4.9): one business day in a few plain sentences — orders against the usual
 * weekday, parcels and deliveries, money in, the best channel — and what needs doing now (anomalies first, then the
 * queues, most urgent first). A template, not a model call: the same numbers always read the same way. Pure; money in
 * major units.
 */
import { currencySymbol } from "@clothing-brand/shared";
import type { Anomaly } from "./anomalies";
import type { OpsCounts } from "./ops-pulse";
import type { OpsQueues } from "./ops-pulse.service";

export interface BriefInput {
  date: string;
  currency: string;
  day: OpsCounts;
  /** Same-weekday mean of the previous four weeks. */
  typical: OpsCounts;
  netSales: number;
  cashIn: number;
  topChannel: { label: string; orders: number; conversionRate: number | null } | null;
  queues: OpsQueues;
  anomalies: Anomaly[];
  /** The books' own warnings now (finance alerts: ad spend missing, courier money unpaid, events not posted…), most
   * severe first. Absent when the books haven't started or the viewer's store has no finance. */
  moneyAlerts?: Array<{ severity: "critical" | "warning" | "info"; title: string; count: number }>;
}

export interface DailyBrief {
  headline: string;
  lines: string[];
  /** What was unusual about the day (§4.9 anomalies), in plain words. */
  unusual: string[];
  /** The work waiting RIGHT NOW (queues at the time the brief is made), most urgent first. */
  todo: string[];
  /** unusual + todo — the notification's "Watch" line. */
  watch: string[];
  /** The brief as one plain-ASCII text (one SMS segment with the store name in front, BRIEF_SMS_MAX): the day's orders and
   * sales, then the counts waiting. Plain ASCII on purpose — a ৳ or Bangla letter makes it a Unicode SMS of 70 characters. */
  sms: string;
}

/** 160 GSM characters is one SMS; the sender adds "<store name>: " in front. */
export const BRIEF_SMS_MAX = 160;

const count = (n: number) => Math.round(n).toLocaleString("en-US");
const avg = (n: number) => (Number.isInteger(n) ? count(n) : n.toFixed(1));
const money = (v: number, currency: string) => `${currencySymbol(currency)}${count(v)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

function vsUsual(value: number, usual: number): string {
  if (usual === 0) return "";
  const pct = Math.round(((value - usual) / usual) * 100);
  return ` (usual ${avg(usual)}${Math.abs(pct) >= 5 ? `, ${pct > 0 ? "+" : "−"}${Math.abs(pct)}%` : ""})`;
}

export function composeBrief(input: BriefInput): DailyBrief {
  const { day, typical, currency, queues } = input;
  const weekday = weekdayOf(input.date);

  const headline =
    day.placed === 0 && input.netSales === 0
      ? `${weekday}: no orders`
      : `${weekday}: ${plural(day.placed, "order")}${vsUsual(day.placed, typical.placed)} · ${money(input.netSales, currency)} net sales`;

  const lines: string[] = [];
  const ended = day.delivered + day.partially_delivered + day.returned;
  if (day.booked || ended) {
    const parts = [`${count(day.booked)} sent to the courier`, `${count(day.delivered)} delivered`];
    if (day.returned) parts.push(`${count(day.returned)} refused`);
    lines.push(`${parts.join(" · ")}${ended ? ` — ${Math.round((day.delivered / ended) * 100)}% delivered in full` : ""}`);
  }
  if (input.cashIn || day.cancelled) {
    const parts = [];
    if (input.cashIn) parts.push(`${money(input.cashIn, currency)} cash in`);
    if (day.cancelled) parts.push(`${count(day.cancelled)} cancelled before sending`);
    lines.push(parts.join(" · "));
  }
  if (input.topChannel && input.topChannel.orders > 0) {
    const c = input.topChannel;
    lines.push(`Best channel: ${c.label} — ${plural(c.orders, "order")}${c.conversionRate !== null ? `, ${(c.conversionRate * 100).toFixed(1)}% of visits ordered` : ""}`);
  }

  const unusual = input.anomalies.map((a) => `${a.label} were ${a.direction === "up" ? "up" : "down"}: ${count(a.value)} against a usual ${avg(a.expected)}`);
  const todo: string[] = [];
  // Money problems lead: a wrong profit or unpaid courier cash costs more than a late call-back. Info items stay on Home.
  const severity = { critical: 0, warning: 1, info: 2 } as const;
  for (const a of [...(input.moneyAlerts ?? [])].filter((a) => a.severity !== "info").sort((x, y) => severity[x.severity] - severity[y.severity])) {
    todo.push(a.count > 1 ? `${a.title} (${count(a.count)})` : a.title);
  }
  if (queues.holdsDue) todo.push(`${plural(queues.holdsDue, "call-back is", "call-backs are")} due`);
  if (queues.readyToBook) todo.push(`${plural(queues.readyToBook, "confirmed order")} not sent to the courier yet`);
  if (queues.awaitingConfirmation) todo.push(`${plural(queues.awaitingConfirmation, "order")} waiting to be confirmed`);
  if (queues.stuckWithCourier) todo.push(`${plural(queues.stuckWithCourier, "parcel")} with the courier for over 5 days`);
  if (queues.partialToReconcile) todo.push(`${plural(queues.partialToReconcile, "part delivery", "part deliveries")} to reconcile`);
  const waiting = [
    queues.awaitingConfirmation ? `${count(queues.awaitingConfirmation)} to confirm` : "",
    queues.readyToBook ? `${count(queues.readyToBook)} to send` : "",
    queues.holdsDue ? `${count(queues.holdsDue)} call-back${queues.holdsDue === 1 ? "" : "s"}` : "",
    queues.stuckWithCourier ? `${count(queues.stuckWithCourier)} stuck` : "",
  ].filter(Boolean);
  const sms = `${weekday.slice(0, 3)}: ${plural(day.placed, "order")}, ${currency} ${count(input.netSales)} sales, ${count(day.delivered)} delivered. ${waiting.length ? `Now: ${waiting.join(", ")}.` : "Nothing waiting."}`;
  return { headline, lines, unusual, todo, watch: [...unusual, ...todo], sms };
}
