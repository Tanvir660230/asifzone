/**
 * Traffic channels (docs/METRICS_REGISTRY.md §4.6): every session is attributed to the channel of its FIRST pageview
 * (referrer, UTM tags, ad click ids → `classifyTraffic`). Sales by channel are the metrics engine's own contributions
 * (orders_placed, realised_net_sales) grouped by the channel of the order's storefront session — never a second sales
 * calculation. Phone / admin-entered orders have no session and are reported as "No website visit".
 *
 * Orders use LAST NON-DIRECT CLICK: a session cookie ends when the browser closes, so someone who clicked a Facebook ad
 * and came back the next day to order arrives "direct". When the ordering session's first touch is direct, the order is
 * credited to the same visitor's (1-year visitorId cookie) most recent non-direct session in the 30 days before it. In
 * the store's data this moved 43% of "direct" orders back to the channel that brought the customer.
 */
import { classifyTraffic, groupContributions, TRAFFIC_CHANNEL_LABELS, type BusinessRange, type OrderFact, type TrafficChannel, type TrafficClass } from "@clothing-brand/shared";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { loadFactsForRange, minorToMajor } from "../../domain/metrics/metrics.service";
import { resolveLegacyWindow, utcInstant } from "../../domain/metrics/store-time";

const CACHE_TTL_SECONDS = 300;
const BATCH = 5000;
/** How far back a direct order looks for the visitor's last non-direct visit. */
export const LOOKBACK_DAYS = 30;

/** The store's own hosts: a first referrer on them means the session cookie restarted mid-visit (direct). */
function ownHosts(): string[] {
  const hosts = new Set<string>();
  for (const origin of [env.webOrigin, process.env.NEXT_PUBLIC_SITE_URL]) {
    const m = origin && /^https?:\/\/([^/:]+)/i.exec(origin);
    if (m) hosts.add(m[1]!.toLowerCase().replace(/^www\./, ""));
  }
  return [...hosts];
}

interface FirstTouch {
  sessionId: string;
  visitorId?: string | null;
  at?: Date;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  path: string;
}

const classify = (t: FirstTouch, own: string[]): TrafficClass => classifyTraffic({ referrer: t.referrer, utmSource: t.utmSource, utmMedium: t.utmMedium, landingPath: t.path }, own);

/** Sessions whose first pageview falls in [startUtc, endUtc), with that pageview. */
async function sessionsStartingIn(range: Pick<BusinessRange, "startUtc" | "endUtc">): Promise<FirstTouch[]> {
  return prisma.$queryRaw<FirstTouch[]>`
    SELECT DISTINCT ON (pv."sessionId") pv."sessionId", pv.referrer, pv."utmSource", pv."utmMedium", pv.path
    FROM "PageView" pv
    WHERE pv."createdAt" >= ${utcInstant(range.startUtc)} AND pv."createdAt" < ${utcInstant(range.endUtc)}
      AND NOT EXISTS (SELECT 1 FROM "PageView" e WHERE e."sessionId" = pv."sessionId" AND e."createdAt" < ${utcInstant(range.startUtc)})
    ORDER BY pv."sessionId", pv."createdAt" ASC`;
}

/** The first pageview of each given session, whenever it was. */
async function firstTouchOf(sessionIds: string[]): Promise<Map<string, FirstTouch>> {
  const out = new Map<string, FirstTouch>();
  for (let i = 0; i < sessionIds.length; i += BATCH) {
    const ids = sessionIds.slice(i, i + BATCH);
    const rows = await prisma.$queryRaw<FirstTouch[]>`
      SELECT DISTINCT ON ("sessionId") "sessionId", "visitorId", "createdAt" AS at, referrer, "utmSource", "utmMedium", path
      FROM "PageView" WHERE "sessionId" = ANY(${ids})
      ORDER BY "sessionId", "createdAt" ASC`;
    for (const r of rows) out.set(r.sessionId, r);
  }
  return out;
}

/** Each visitor's sessions (first touch) that began in [from, to) — for last-non-direct attribution. */
async function visitorSessions(visitorIds: string[], from: Date, to: Date): Promise<Map<string, FirstTouch[]>> {
  const out = new Map<string, FirstTouch[]>();
  for (let i = 0; i < visitorIds.length; i += BATCH) {
    const ids = visitorIds.slice(i, i + BATCH);
    const rows = await prisma.$queryRaw<FirstTouch[]>`
      SELECT * FROM (
        SELECT DISTINCT ON ("sessionId") "sessionId", "visitorId", "createdAt" AS at, referrer, "utmSource", "utmMedium", path
        FROM "PageView" WHERE "visitorId" = ANY(${ids}) AND "createdAt" >= ${utcInstant(from)} AND "createdAt" < ${utcInstant(to)}
        ORDER BY "sessionId", "createdAt" ASC
      ) s`;
    for (const r of rows) out.set(r.visitorId!, [...(out.get(r.visitorId!) ?? []), r]);
  }
  return out;
}

/** The channel an order is credited to: its session's first touch, or — when that is direct — the visitor's latest
 * non-direct session within LOOKBACK_DAYS before it. */
function creditFor(touch: FirstTouch, history: FirstTouch[] | undefined, own: string[]): { cls: TrafficClass; reattributed: boolean } {
  const cls = classify(touch, own);
  if (cls.channel !== "direct" || !history || !touch.at) return { cls, reattributed: false };
  const start = new Date(touch.at).getTime();
  const earliest = start - LOOKBACK_DAYS * 86_400_000;
  let best: { at: number; cls: TrafficClass } | null = null;
  for (const h of history) {
    if (h.sessionId === touch.sessionId || !h.at) continue;
    const at = new Date(h.at).getTime();
    if (at >= start || at < earliest) continue;
    const c = classify(h, own);
    if (c.channel !== "direct" && (!best || at > best.at)) best = { at, cls: c };
  }
  return best ? { cls: best.cls, reattributed: true } : { cls, reattributed: false };
}

/** The credited channel (last non-direct click) of each storefront session that placed an order. */
export async function creditedChannels(sessionIds: string[], own: string[] = ownHosts()): Promise<Map<string, { cls: TrafficClass; reattributed: boolean }>> {
  const touches = await firstTouchOf(sessionIds);
  const directVisitors = [...touches.values()].filter((t) => t.visitorId && t.at && classify(t, own).channel === "direct");
  const history = directVisitors.length
    ? await visitorSessions(
        [...new Set(directVisitors.map((t) => t.visitorId!))],
        new Date(Math.min(...directVisitors.map((t) => new Date(t.at!).getTime())) - LOOKBACK_DAYS * 86_400_000),
        new Date(Math.max(...directVisitors.map((t) => new Date(t.at!).getTime()))),
      )
    : new Map<string, FirstTouch[]>();
  const credit = new Map<string, { cls: TrafficClass; reattributed: boolean }>();
  for (const t of touches.values()) credit.set(t.sessionId, creditFor(t, t.visitorId ? history.get(t.visitorId) : undefined, own));
  return credit;
}

/** "Facebook ads", "Google", … */
export const channelLabel = (c: TrafficClass) => labelOf(c);

const keyOf = (c: TrafficClass) => `${c.channel}:${c.paid ? "paid" : "organic"}`;
const labelOf = (c: TrafficClass) => `${TRAFFIC_CHANNEL_LABELS[c.channel]}${c.paid ? " ads" : ""}`;

export interface TrafficSourceRow {
  /** Display label, e.g. "Facebook" / "Facebook ads" (kept as `source` for existing callers). */
  source: string;
  channel: TrafficChannel;
  paid: boolean;
  sessions: number;
}

/** Sessions started in the window, by channel (organic and paid apart), largest first. */
export async function getTrafficSources(days = 30, limit = 10, dateFrom?: Date, dateTo?: Date): Promise<TrafficSourceRow[]> {
  const range = await resolveLegacyWindow(days, dateFrom, dateTo);
  const key = `analytics:v6:traffic-sources:${range.timezone}:${range.startUtc.toISOString()}:${range.endUtc.toISOString()}:${limit}`;
  const hit = await cacheGet<TrafficSourceRow[]>(key);
  if (hit) return hit;
  const own = ownHosts();
  const counts = new Map<string, TrafficSourceRow>();
  for (const t of await sessionsStartingIn(range)) {
    const c = classify(t, own);
    const row = counts.get(keyOf(c)) ?? { source: labelOf(c), channel: c.channel, paid: c.paid, sessions: 0 };
    row.sessions += 1;
    counts.set(keyOf(c), row);
  }
  const result = [...counts.values()].sort((a, b) => b.sessions - a.sessions).slice(0, limit);
  await cacheSet(key, result, CACHE_TTL_SECONDS);
  return result;
}

export interface ChannelPerformanceRow {
  key: string;
  label: string;
  channel: TrafficChannel | null;
  paid: boolean;
  sessions: number;
  orders: number;
  /** orders ÷ sessions (0–1); null for the no-visit row. */
  conversionRate: number | null;
  /** realised_net_sales of those orders in the window (major units). */
  netSales: number;
  realisedOrders: number;
  /** netSales ÷ realisedOrders (P5-5 AOV over the channel's orders). */
  aov: number;
}

/**
 * Per channel: sessions started in the window, orders placed in it from those channels' sessions, conversion, realised
 * net sales and AOV. Orders are attributed by their session's first touch, even when that session started before the
 * window (a visit on the 30th that orders on the 1st still came from that channel).
 */
export async function getChannelPerformance(
  days?: number,
  dateFrom?: Date,
  dateTo?: Date,
): Promise<{ channels: ChannelPerformanceRow[]; totals: { sessions: number; orders: number; netSales: number; reattributedFromDirect: number }; lookbackDays: number }> {
  const range = await resolveLegacyWindow(days, dateFrom, dateTo);
  const key = `analytics:v6:channel-performance:${range.timezone}:${range.startUtc.toISOString()}:${range.endUtc.toISOString()}`;
  const hit = await cacheGet<Awaited<ReturnType<typeof getChannelPerformance>>>(key);
  if (hit) return hit;

  const own = ownHosts();
  const [sessions, { orders, currency }] = await Promise.all([sessionsStartingIn(range), loadFactsForRange(range)]);
  const orderSessions = [...new Set(orders.map((o) => o.sessionId).filter((s): s is string => Boolean(s)))];
  const credit = await creditedChannels(orderSessions, own);

  const rows = new Map<string, ChannelPerformanceRow>();
  const row = (k: string, init: () => Omit<ChannelPerformanceRow, "sessions" | "orders" | "netSales" | "realisedOrders" | "aov" | "conversionRate">) => {
    let r = rows.get(k);
    if (!r) {
      r = { ...init(), sessions: 0, orders: 0, conversionRate: null, netSales: 0, realisedOrders: 0, aov: 0 };
      rows.set(k, r);
    }
    return r;
  };
  for (const t of sessions) {
    const c = classify(t, own);
    row(keyOf(c), () => ({ key: keyOf(c), label: labelOf(c), channel: c.channel, paid: c.paid })).sessions += 1;
  }

  const NO_VISIT = "none";
  const channelOfOrder = (o: OrderFact): string => {
    const cr = o.sessionId ? credit.get(o.sessionId) : undefined;
    if (!cr) return NO_VISIT;
    const c = cr.cls;
    row(keyOf(c), () => ({ key: keyOf(c), label: labelOf(c), channel: c.channel, paid: c.paid }));
    return keyOf(c);
  };
  const keyFn = (c: { order: OrderFact }) => channelOfOrder(c.order);
  const placed = groupContributions("orders_placed", orders, range, keyFn);
  const sumPlaced = (pick: (o: OrderFact) => boolean) => [...groupContributions("orders_placed", orders, range, (c) => (pick(c.order) ? "x" : null)).values()].reduce((s, v) => s + v, 0);
  const net = groupContributions("realised_net_sales", orders, range, keyFn);
  const realised = groupContributions("orders_realised", orders, range, keyFn);
  for (const k of new Set([...placed.keys(), ...net.keys()])) {
    const r = k === NO_VISIT ? row(NO_VISIT, () => ({ key: NO_VISIT, label: "No website visit (phone, admin)", channel: null, paid: false })) : rows.get(k)!;
    r.orders = placed.get(k) ?? 0;
    r.netSales = minorToMajor(net.get(k) ?? 0, currency);
    r.realisedOrders = realised.get(k) ?? 0;
    r.aov = r.realisedOrders > 0 ? minorToMajor(Math.round((net.get(k) ?? 0) / r.realisedOrders), currency) : 0;
  }
  for (const r of rows.values()) r.conversionRate = r.key === NO_VISIT ? null : r.sessions > 0 ? r.orders / r.sessions : 0;

  const channels = [...rows.values()].sort((a, b) => b.netSales - a.netSales || b.orders - a.orders || b.sessions - a.sessions);
  const result = {
    channels,
    totals: {
      sessions: sessions.length,
      orders: channels.reduce((s, r) => s + r.orders, 0),
      netSales: minorToMajor([...net.values()].reduce((s, v) => s + v, 0), currency),
      reattributedFromDirect: sumPlaced((o) => Boolean(o.sessionId && credit.get(o.sessionId)?.reattributed)),
    },
    lookbackDays: LOOKBACK_DAYS,
  };
  await cacheSet(key, result, CACHE_TTL_SECONDS);
  return result;
}
