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
}

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
  if (queues.holdsDue) todo.push(`${plural(queues.holdsDue, "call-back is", "call-backs are")} due`);
  if (queues.readyToBook) todo.push(`${plural(queues.readyToBook, "confirmed order")} not sent to the courier yet`);
  if (queues.awaitingConfirmation) todo.push(`${plural(queues.awaitingConfirmation, "order")} waiting to be confirmed`);
  if (queues.stuckWithCourier) todo.push(`${plural(queues.stuckWithCourier, "parcel")} with the courier for over 5 days`);
  if (queues.partialToReconcile) todo.push(`${plural(queues.partialToReconcile, "part delivery", "part deliveries")} to reconcile`);
  return { headline, lines, unusual, todo, watch: [...unusual, ...todo] };
}
