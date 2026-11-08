import { CANCEL_REASONS, CANCEL_REASON_LABELS, classifyCancelNote, type CancelReason } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { resolveLegacyWindow } from "../../domain/metrics/store-time";
import { channelLabel, creditedChannels, firstTouchOf } from "./traffic.service";

/**
 * Orders cancelled before they were sent (docs/superpowers/plans/2026-11-08-order-outcomes-programme.md, PR 2): how
 * many, why (the cancel note, read by classifyCancelNote), and where they came from — channel, landing page, product.
 * A parcel refused at the door after booking is a delivery outcome (Deliveries); it is counted here only as a total, so
 * "23 % cancelled" splits into the two problems it really is.
 */

export interface CancelBreakdownRow {
  key: string;
  label: string;
  orders: number;
  cancelled: number;
  /** cancelled ÷ orders */
  rate: number;
}

export interface CancellationsReport {
  range: { from: string; to: string };
  totals: { orders: number; cancelledBeforeSending: number; cancelRate: number; refusedAfterSending: number };
  reasons: Array<{ reason: CancelReason; label: string; count: number; share: number }>;
  byChannel: CancelBreakdownRow[];
  byLanding: CancelBreakdownRow[];
  byProduct: CancelBreakdownRow[];
  /** Groups smaller than this are left out of the landing and product tables (too few to mean anything). */
  minOrders: number;
}

const MIN_ORDERS = 5;
const TOP = 10;

/** "/lp/caps?fbclid=…" → "/lp/caps"; the bare path is the page an ad or a post sent the visitor to. */
export function landingKey(path: string | null | undefined): string {
  if (!path) return "(unknown)";
  const bare = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  return bare.length > 80 ? bare.slice(0, 80) : bare;
}

function rows(groups: Map<string, { label: string; orders: number; cancelled: number }>, min: number): CancelBreakdownRow[] {
  return [...groups.entries()]
    .filter(([, g]) => g.orders >= min)
    .map(([key, g]) => ({ key, label: g.label, orders: g.orders, cancelled: g.cancelled, rate: g.orders ? g.cancelled / g.orders : 0 }))
    .sort((a, b) => b.cancelled - a.cancelled || b.rate - a.rate || b.orders - a.orders);
}

export async function getCancellations(days?: number, dateFrom?: Date, dateTo?: Date): Promise<CancellationsReport> {
  const range = await resolveLegacyWindow(days, dateFrom, dateTo);
  const key = `analytics:v1:cancellations:${range.timezone}:${range.startUtc.toISOString()}:${range.endUtc.toISOString()}`;
  const hit = await cacheGet<CancellationsReport>(key);
  if (hit) return hit;

  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: range.startUtc, lt: range.endUtc }, deletedAt: null },
    select: { id: true, status: true, courierConsignmentId: true, sessionId: true },
  });
  // Booked with the courier and then cancelled or returned: refused at the door (or lost) — not a pre-send cancel.
  const sent = (o: (typeof orders)[number]) => Boolean(o.courierConsignmentId);
  const isCancelled = (o: (typeof orders)[number]) => o.status === "CANCELLED" && !sent(o);
  const refused = orders.filter((o) => sent(o) && (o.status === "CANCELLED" || o.status === "RETURNED")).length;
  const cancelledIds = orders.filter(isCancelled).map((o) => o.id);

  const sessionIds = [...new Set(orders.map((o) => o.sessionId).filter((s): s is string => Boolean(s)))];
  const [notes, items, credit, touches] = await Promise.all([
    cancelledIds.length
      ? prisma.orderStatusHistory.findMany({ where: { orderId: { in: cancelledIds }, status: "CANCELLED" }, select: { orderId: true, note: true, createdAt: true }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    prisma.orderItem.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, select: { orderId: true, productIdSnapshot: true, productNameSnapshot: true } }),
    creditedChannels(sessionIds),
    firstTouchOf(sessionIds),
  ]);

  // The reason: the last cancel note on the order (a re-cancel after a restore says the latest why).
  const noteOf = new Map<string, string | null>();
  for (const n of notes) noteOf.set(n.orderId, n.note);
  const reasonCount = new Map<CancelReason, number>();
  for (const id of cancelledIds) {
    const r = classifyCancelNote(noteOf.get(id));
    reasonCount.set(r, (reasonCount.get(r) ?? 0) + 1);
  }

  const add = (m: Map<string, { label: string; orders: number; cancelled: number }>, k: string, label: string, cancelled: boolean) => {
    const g = m.get(k) ?? { label, orders: 0, cancelled: 0 };
    g.orders += 1;
    if (cancelled) g.cancelled += 1;
    m.set(k, g);
  };
  const byChannel = new Map<string, { label: string; orders: number; cancelled: number }>();
  const byLanding = new Map<string, { label: string; orders: number; cancelled: number }>();
  const byProduct = new Map<string, { label: string; orders: number; cancelled: number }>();
  const productsOf = new Map<string, Map<string, string>>();
  for (const i of items) {
    const m = productsOf.get(i.orderId) ?? new Map<string, string>();
    m.set(i.productIdSnapshot ?? i.productNameSnapshot, i.productNameSnapshot);
    productsOf.set(i.orderId, m);
  }
  for (const o of orders) {
    const c = isCancelled(o);
    const cls = o.sessionId ? credit.get(o.sessionId)?.cls : undefined;
    const channel = cls ? channelLabel(cls) : "Unknown";
    add(byChannel, channel, channel, c);
    const landing = landingKey(o.sessionId ? touches.get(o.sessionId)?.path : null);
    add(byLanding, landing, landing, c);
    for (const [pid, name] of productsOf.get(o.id) ?? []) add(byProduct, pid, name, c);
  }

  const cancelled = cancelledIds.length;
  const report: CancellationsReport = {
    range: { from: range.startUtc.toISOString(), to: range.endUtc.toISOString() },
    totals: { orders: orders.length, cancelledBeforeSending: cancelled, cancelRate: orders.length ? cancelled / orders.length : 0, refusedAfterSending: refused },
    reasons: CANCEL_REASONS.map((reason) => ({ reason, label: CANCEL_REASON_LABELS[reason], count: reasonCount.get(reason) ?? 0, share: cancelled ? (reasonCount.get(reason) ?? 0) / cancelled : 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count),
    byChannel: rows(byChannel, 1),
    byLanding: rows(byLanding, MIN_ORDERS).slice(0, TOP),
    byProduct: rows(byProduct, MIN_ORDERS).slice(0, TOP),
    minOrders: MIN_ORDERS,
  };
  await cacheSet(key, report, 300);
  return report;
}
