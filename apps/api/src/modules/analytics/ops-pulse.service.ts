/**
 * Daily pulse loader (docs/METRICS_REGISTRY.md §4.5): reads order operations as events (ops-pulse.ts counts them) plus
 * the live queues an operator works from. Every window is a business range in the store timezone and every bound
 * instant reaches SQL through `utcInstant`. Population: operational orders (not trashed, not exchange replacements).
 * Money sales figures are not computed here — the day table takes realised net sales and cash from the metrics engine.
 */
import { Prisma } from "@prisma/client";
import { addDays, businessDate, businessDayStartUtc, fromMajor, money, resolveBusinessRange, toMajor, type BusinessRange } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { computeMetrics } from "../../domain/metrics/metrics.service";
import { storeContext, utcInstant } from "../../domain/metrics/store-time";
import { OPERATIONAL_ORDER_WHERE } from "../../domain/metrics/sale-order";
import { codToCollectFor } from "../../domain/payments/payment-ledger.service";
import { compareOps, countOps, hourlyPlaced, OPS_COUNT_KEYS, type OpsCounts, type OpsEvent, type OpsEventKind, type OrderSource } from "./ops-pulse";

const CACHE_TTL_SECONDS = 60;
/** A parcel booked this many days ago and still not delivered, refused or returned is "stuck with the courier". */
export const STUCK_WITH_COURIER_DAYS = 5;
const MAX_DAILY_RANGE_DAYS = 366;

/** Moved forward from PENDING: the first of these is the order's confirmation (most COD orders go PENDING → PACKED when
 * booked, with no CONFIRMED entry of their own). */
const ACCEPTED_STATUSES = ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "PARTIALLY_DELIVERED"];
/** Statuses that are their own event (first entry of each). CANCELLED and RETURNED are classified in the query. */
const STATUS_EVENTS: Record<string, OpsEventKind> = {
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  PARTIALLY_DELIVERED: "partially_delivered",
  CANCELLED: "cancelled",
  REFUSED: "returned",
};
/** With the courier: booked and not yet delivered, refused or returned. */
const WITH_COURIER_STATUSES = ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"] as const;

/** Not trashed and not an exchange replacement, on an "Order" alias (OPERATIONAL_ORDER_WHERE in SQL). */
function operationalSql(alias: string): Prisma.Sql {
  const a = Prisma.raw(alias);
  return Prisma.sql`${a}."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "ReturnRequest" rr WHERE rr."exchangeOrderId" = ${a}.id)`;
}

/**
 * Every ops event in [startUtc, endUtc). Placed orders carry their source: "phone" when the order's first history entry
 * was made by an admin (entered from the admin panel), "landing" when its storefront session visited a /lp/ page, "web"
 * for any other storefront session, else "other". A status event is the order's FIRST entry of that status, except:
 * - confirmed = the first entry of any ACCEPTED_STATUSES (the order moved forward from PENDING);
 * - a CANCELLED after the parcel was booked is the courier bringing it back (refused) → "returned", as is a RETURNED
 *   entry; each order returns at most once (its first such entry). A CANCELLED before booking stays "cancelled".
 */
export async function loadOpsEvents(range: Pick<BusinessRange, "startUtc" | "endUtc">, currency: string): Promise<OpsEvent[]> {
  const [placed, statuses, booked] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; at: Date; manual: boolean; landing: boolean; session: boolean }>>`
      SELECT o.id, o."createdAt" AS at,
        COALESCE((SELECT h."changedByAdminId" IS NOT NULL FROM "OrderStatusHistory" h WHERE h."orderId" = o.id ORDER BY h."createdAt" ASC, h.id ASC LIMIT 1), false) AS manual,
        (o."sessionId" IS NOT NULL AND EXISTS (SELECT 1 FROM "PageView" p WHERE p."sessionId" = o."sessionId" AND p.path LIKE '/lp/%')) AS landing,
        (o."sessionId" IS NOT NULL) AS session
      FROM "Order" o
      WHERE ${operationalSql("o")} AND o."createdAt" >= ${utcInstant(range.startUtc)} AND o."createdAt" < ${utcInstant(range.endUtc)}`,
    prisma.$queryRaw<Array<{ orderId: string; status: string; at: Date }>>`
      SELECT e."orderId", e.status, MIN(e.at) AS at FROM (
        SELECT h."orderId", h."createdAt" AS at,
          CASE
            WHEN h.status = 'RETURNED' THEN 'REFUSED'
            WHEN h.status = 'CANCELLED' AND o."courierBookedAt" IS NOT NULL AND o."courierBookedAt" <= h."createdAt" THEN 'REFUSED'
            ELSE h.status::text
          END AS status
        FROM "OrderStatusHistory" h JOIN "Order" o ON o.id = h."orderId"
        WHERE ${operationalSql("o")} AND h.status::text IN (${Prisma.join([...Object.keys(STATUS_EVENTS).filter((s) => s !== "REFUSED"), "RETURNED"])})
        UNION ALL
        SELECT h."orderId", h."createdAt" AS at, 'ACCEPTED' AS status
        FROM "OrderStatusHistory" h JOIN "Order" o ON o.id = h."orderId"
        WHERE ${operationalSql("o")} AND h.status::text IN (${Prisma.join(ACCEPTED_STATUSES)})
      ) e
      GROUP BY e."orderId", e.status
      HAVING MIN(e.at) >= ${utcInstant(range.startUtc)} AND MIN(e.at) < ${utcInstant(range.endUtc)}`,
    // COD value at booking: the order total less the online / manual money already settled for it by then (what the
    // rider is asked to collect). Prepaid parcels contribute 0.
    prisma.$queryRaw<Array<{ id: string; at: Date; cod: Prisma.Decimal }>>`
      SELECT o.id, o."courierBookedAt" AS at,
        GREATEST(o."total" - COALESCE((SELECT SUM(p.amount) FROM "Payment" p WHERE p."orderId" = o.id AND p.purpose = 'ORDER' AND p.status = 'SUCCEEDED' AND p.provider <> 'COD' AND p."settledAt" <= o."courierBookedAt"), 0), 0) AS cod
      FROM "Order" o
      WHERE ${operationalSql("o")} AND o."courierBookedAt" >= ${utcInstant(range.startUtc)} AND o."courierBookedAt" < ${utcInstant(range.endUtc)}`,
  ]);
  const source = (r: { manual: boolean; landing: boolean; session: boolean }): OrderSource => (r.manual ? "phone" : r.landing ? "landing" : r.session ? "web" : "other");
  return [
    ...placed.map((r): OpsEvent => ({ kind: "placed", at: r.at, orderId: r.id, source: source(r) })),
    ...statuses.map((r): OpsEvent => ({ kind: r.status === "ACCEPTED" ? "confirmed" : STATUS_EVENTS[r.status]!, at: r.at, orderId: r.orderId })),
    ...booked.map((r): OpsEvent => ({ kind: "booked", at: r.at, orderId: r.id, codValue: fromMajor(r.cod.toString(), currency).amount })),
  ];
}

const toMajorCounts = (c: OpsCounts, currency: string): OpsCounts => ({ ...c, booked_cod_value: toMajor(money(Math.round(c.booked_cod_value), currency)) });

async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit) return hit;
  const value = await compute();
  await cacheSet(key, value, CACHE_TTL_SECONDS);
  return value;
}

function parseDate(date: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw AppError.badRequest(`${label} must be YYYY-MM-DD`, { code: "INVALID_RANGE" });
  return date;
}

export interface OpsQueues {
  awaitingConfirmation: number;
  onHold: number;
  holdsDue: number;
  readyToBook: number;
  /** Booked and not yet delivered, refused or returned. */
  withCourier: number;
  /** COD the courier is still to collect on those parcels (major units). */
  withCourierCod: number;
  /** Of those, booked more than STUCK_WITH_COURIER_DAYS ago. */
  stuckWithCourier: number;
  partialToReconcile: number;
}

/** The work waiting right now (point in time). */
export async function opsQueues(now: Date = new Date()): Promise<OpsQueues> {
  const { currency } = await storeContext();
  const stuckBefore = new Date(now.getTime() - STUCK_WITH_COURIER_DAYS * 86_400_000);
  const withCourier = { ...OPERATIONAL_ORDER_WHERE, status: { in: [...WITH_COURIER_STATUSES] }, courierBookedAt: { not: null } };
  const [awaitingConfirmation, onHold, holdsDue, readyToBook, parcels, stuckWithCourier, partialToReconcile] = await Promise.all([
    prisma.order.count({ where: { ...OPERATIONAL_ORDER_WHERE, status: "PENDING", followUpAt: null } }),
    prisma.order.count({ where: { ...OPERATIONAL_ORDER_WHERE, status: "PENDING", followUpAt: { not: null } } }),
    prisma.order.count({ where: { ...OPERATIONAL_ORDER_WHERE, status: "PENDING", followUpAt: { lte: now } } }),
    prisma.order.count({ where: { ...OPERATIONAL_ORDER_WHERE, status: { in: ["CONFIRMED", "PROCESSING", "PACKED"] }, courierBookedAt: null } }),
    prisma.order.findMany({ where: withCourier, select: { id: true } }),
    prisma.order.count({ where: { ...withCourier, courierBookedAt: { not: null, lt: stuckBefore } } }),
    prisma.order.count({ where: { ...OPERATIONAL_ORDER_WHERE, status: "PARTIALLY_DELIVERED", partialDeliveryReconciledAt: null } }),
  ]);
  const cod = await codToCollectFor(parcels.map((p) => p.id));
  const withCourierCodMinor = [...cod.values()].reduce((sum, v) => sum + fromMajor(String(v), currency).amount, 0);
  return {
    awaitingConfirmation,
    onHold,
    holdsDue,
    readyToBook,
    withCourier: parcels.length,
    withCourierCod: toMajor(money(withCourierCodMinor, currency)),
    stuckWithCourier,
    partialToReconcile,
  };
}

export interface StaffDayRow {
  adminId: string;
  name: string;
  confirmed: number;
  cancelled: number;
  packed: number;
  shipped: number;
  other: number;
  total: number;
}

/** Status changes each admin made in [startUtc, endUtc) (every entry, not only firsts — this is work done). */
async function staffActivity(range: Pick<BusinessRange, "startUtc" | "endUtc">): Promise<StaffDayRow[]> {
  const rows = await prisma.$queryRaw<Array<{ adminId: string; name: string; status: string; n: bigint }>>`
    SELECT h."changedByAdminId" AS "adminId", a.name, h.status::text AS status, COUNT(*)::bigint AS n
    FROM "OrderStatusHistory" h JOIN "AdminUser" a ON a.id = h."changedByAdminId"
    WHERE h."createdAt" >= ${utcInstant(range.startUtc)} AND h."createdAt" < ${utcInstant(range.endUtc)}
    GROUP BY h."changedByAdminId", a.name, h.status`;
  const byAdmin = new Map<string, StaffDayRow>();
  for (const r of rows) {
    const row = byAdmin.get(r.adminId) ?? { adminId: r.adminId, name: r.name, confirmed: 0, cancelled: 0, packed: 0, shipped: 0, other: 0, total: 0 };
    const n = Number(r.n);
    const key = r.status === "CONFIRMED" ? "confirmed" : r.status === "CANCELLED" ? "cancelled" : r.status === "PACKED" ? "packed" : r.status === "SHIPPED" ? "shipped" : "other";
    row[key] += n;
    row.total += n;
    byAdmin.set(r.adminId, row);
  }
  return [...byAdmin.values()].sort((a, b) => b.total - a.total);
}

export interface CohortOutcome {
  placed: number;
  waiting: number;
  onHold: number;
  /** Confirmed, not yet booked with the courier. */
  confirmed: number;
  /** Booked and not yet delivered, refused or returned. */
  withCourier: number;
  delivered: number;
  /** Refused at the door (cancelled after booking) or returned. */
  returned: number;
  /** Cancelled before it was booked. */
  cancelled: number;
}

/** Where the orders placed in [startUtc, endUtc) stand now (same refused-vs-cancelled rule as the events). */
async function cohortOutcome(range: Pick<BusinessRange, "startUtc" | "endUtc">): Promise<CohortOutcome> {
  const orders = await prisma.order.findMany({
    where: { ...OPERATIONAL_ORDER_WHERE, createdAt: { gte: range.startUtc, lt: range.endUtc } },
    select: { status: true, followUpAt: true, courierBookedAt: true },
  });
  const out: CohortOutcome = { placed: orders.length, waiting: 0, onHold: 0, confirmed: 0, withCourier: 0, delivered: 0, returned: 0, cancelled: 0 };
  for (const o of orders) {
    const booked = o.courierBookedAt !== null;
    if (o.status === "PENDING") out[o.followUpAt ? "onHold" : "waiting"] += 1;
    else if (o.status === "DELIVERED" || o.status === "PARTIALLY_DELIVERED") out.delivered += 1;
    else if (o.status === "RETURNED" || o.status === "REFUNDED" || (o.status === "CANCELLED" && booked)) out.returned += 1;
    else if (o.status === "CANCELLED") out.cancelled += 1;
    else out[booked ? "withCourier" : "confirmed"] += 1;
  }
  return out;
}

export interface OpsPulse {
  date: string;
  timezone: string;
  currency: string;
  /** True when `date` is today: every comparison day is cut at the same time of day (`asOf`). */
  partialDay: boolean;
  asOf: string | null;
  day: OpsCounts;
  yesterday: OpsCounts;
  lastWeek: OpsCounts;
  typical: OpsCounts;
  comparisonDates: { yesterday: string; lastWeek: string; typical: string[] };
  hourly: Array<{ hour: number; day: number; typical: number }>;
  cohort: CohortOutcome;
  staff: StaffDayRow[];
  queues: OpsQueues;
}

/** The pulse of one business date (default today) against yesterday, last week and the 4-week same-weekday average. */
export async function getOpsPulse(dateInput?: string, now: Date = new Date()): Promise<OpsPulse> {
  const { timezone, currency } = await storeContext();
  const today = businessDate(now, timezone);
  const date = dateInput ? parseDate(dateInput, "date") : today;
  if (date > today) throw AppError.badRequest("date can't be in the future", { code: "INVALID_RANGE" });
  const partialDay = date === today;
  const cutoffMs = partialDay ? now.getTime() - businessDayStartUtc(date, timezone).getTime() : undefined;
  const bucket = partialDay ? Math.floor(now.getTime() / 60_000) : 0; // a day in progress refreshes each minute

  return cached(`ops-pulse:v1:${timezone}:${date}:${bucket}`, async () => {
    const window = resolveBusinessRange({ from: addDays(date, -28), to: date }, timezone, now);
    const dayRange = resolveBusinessRange({ from: date, to: date }, timezone, now);
    const [events, staff, cohort, queues] = await Promise.all([loadOpsEvents(window, currency), staffActivity(dayRange), cohortOutcome(dayRange), opsQueues(now)]);
    const cmp = compareOps(events, date, timezone, cutoffMs);
    return {
      date,
      timezone,
      currency,
      partialDay,
      asOf: partialDay ? now.toISOString() : null,
      day: toMajorCounts(cmp.day, currency),
      yesterday: toMajorCounts(cmp.yesterday, currency),
      lastWeek: toMajorCounts(cmp.lastWeek, currency),
      typical: toMajorCounts(cmp.typical, currency),
      comparisonDates: { yesterday: addDays(date, -1), lastWeek: addDays(date, -7), typical: [7, 14, 21, 28].map((n) => addDays(date, -n)) },
      hourly: hourlyPlaced(events, date, timezone),
      cohort,
      staff,
      queues,
    };
  });
}

export interface OpsDailyRow extends OpsCounts {
  date: string;
  /** From the metrics engine (§4.1): realised net sales, orders realised and payments received that day. */
  realised_net_sales: number;
  orders_realised: number;
  payments_received: number;
}

/** One row per business date in [from, to] — every ops count plus the day's realised sales and cash, for any range. */
export async function getOpsDaily(fromInput: string, toInput: string, now: Date = new Date()): Promise<{ timezone: string; currency: string; days: OpsDailyRow[]; totals: OpsDailyRow }> {
  const { timezone, currency } = await storeContext();
  const from = parseDate(fromInput, "from");
  const to = parseDate(toInput, "to");
  if (from > to) throw AppError.badRequest("from must be on or before to", { code: "INVALID_RANGE" });
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (span > MAX_DAILY_RANGE_DAYS) throw AppError.badRequest(`At most ${MAX_DAILY_RANGE_DAYS} days`, { code: "INVALID_RANGE" });

  return cached(`ops-daily:v1:${timezone}:${from}:${to}:${Math.floor(now.getTime() / 60_000)}`, async () => {
    const range = resolveBusinessRange({ from, to }, timezone, now);
    const dates = Array.from({ length: span }, (_, i) => addDays(from, i));
    const [events, metrics] = await Promise.all([
      loadOpsEvents(range, currency),
      computeMetrics({ metrics: ["realised_net_sales", "orders_realised", "payments_received"], range: { from, to }, groupBy: "day" }, now),
    ]);
    const counts = countOps(events, dates, timezone);
    const sales = new Map((metrics.groups ?? []).map((g) => [g.key, g.metrics]));
    const days = dates.map((date): OpsDailyRow => {
      const m = sales.get(date) ?? {};
      return { date, ...toMajorCounts(counts[date]!, currency), realised_net_sales: m.realised_net_sales ?? 0, orders_realised: m.orders_realised ?? 0, payments_received: m.payments_received ?? 0 };
    });
    const totals = { date: "total" } as OpsDailyRow;
    for (const k of [...OPS_COUNT_KEYS, "realised_net_sales", "orders_realised", "payments_received"] as const) totals[k] = days.reduce((s, d) => s + d[k], 0);
    totals.realised_net_sales = metrics.metrics.realised_net_sales?.value ?? totals.realised_net_sales;
    totals.payments_received = metrics.metrics.payments_received?.value ?? totals.payments_received;
    return { timezone, currency, days, totals };
  });
}
