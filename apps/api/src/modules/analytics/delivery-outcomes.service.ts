/**
 * Delivery outcomes loader (docs/METRICS_REGISTRY.md §4.7). Population: operational orders booked with the courier whose
 * parcel FINISHED in the window. The outcome is the earliest of: first DELIVERED (delivered), first PARTIALLY_DELIVERED
 * (partial), or the refusal — a CANCELLED entry at or after booking, or a RETURNED entry (refused). A later customer
 * return of a delivered parcel doesn't turn a delivery into a refusal: the delivery came first.
 */
import { Prisma } from "@prisma/client";
import { fromMajor, money, previousRange, toMajor, type BusinessRange } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { resolveLegacyWindow, storeContext, utcInstant } from "../../domain/metrics/store-time";
import { breakdown, outcomeTotals, repeatRefusers, valueBand, valueBands, weeklyTrend, type BreakdownRow, type OutcomeTotals, type Parcel, type ParcelOutcome, type RepeatRefuser } from "./delivery-outcomes";
import { channelLabel, creditedChannels } from "./traffic.service";

const CACHE_TTL_SECONDS = 300;
/** A district / product needs this many finished parcels before its rate is shown. */
export const MIN_PARCELS = 3;

interface Row {
  id: string;
  booked: Date;
  ended: Date;
  outcome: ParcelOutcome;
  district: string;
  division: string;
  paymentMethod: string;
  total: Prisma.Decimal;
  cod: Prisma.Decimal;
  phone: string;
  name: string;
  sessionId: string | null;
  repeat: boolean;
}

/** Every parcel that finished in [startUtc, endUtc). */
export async function loadParcels(range: Pick<BusinessRange, "startUtc" | "endUtc">, currency: string): Promise<Parcel[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT * FROM (
      SELECT x.*,
        LEAST(x.d_at, x.p_at, x.r_at) AS ended,
        CASE LEAST(x.d_at, x.p_at, x.r_at) WHEN x.d_at THEN 'delivered' WHEN x.p_at THEN 'partial' ELSE 'refused' END AS outcome
      FROM (
        SELECT o.id, o."courierBookedAt" AS booked, o."shippingDistrict" AS district, o."shippingDivision" AS division,
          o."paymentMethod"::text AS "paymentMethod", o.total, o."customerPhone" AS phone, o."customerName" AS name, o."sessionId",
          (SELECT MIN(h."createdAt") FROM "OrderStatusHistory" h WHERE h."orderId" = o.id AND h.status = 'DELIVERED') AS d_at,
          (SELECT MIN(h."createdAt") FROM "OrderStatusHistory" h WHERE h."orderId" = o.id AND h.status = 'PARTIALLY_DELIVERED') AS p_at,
          (SELECT MIN(h."createdAt") FROM "OrderStatusHistory" h WHERE h."orderId" = o.id
             AND (h.status = 'RETURNED' OR (h.status = 'CANCELLED' AND h."createdAt" >= o."courierBookedAt"))) AS r_at,
          GREATEST(o.total - COALESCE((SELECT SUM(p.amount) FROM "Payment" p WHERE p."orderId" = o.id AND p.purpose = 'ORDER' AND p.status = 'SUCCEEDED' AND p.provider <> 'COD' AND p."settledAt" <= o."courierBookedAt"), 0), 0) AS cod,
          EXISTS (SELECT 1 FROM "Order" e WHERE e."customerPhone" = o."customerPhone" AND e."deletedAt" IS NULL AND e."createdAt" < o."createdAt") AS repeat
        FROM "Order" o
        WHERE o."deletedAt" IS NULL AND o."courierBookedAt" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "ReturnRequest" rr WHERE rr."exchangeOrderId" = o.id)
      ) x
    ) y
    WHERE y.ended >= ${utcInstant(range.startUtc)} AND y.ended < ${utcInstant(range.endUtc)}`;
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const [items, credit] = await Promise.all([
    prisma.orderItem.findMany({ where: { orderId: { in: ids } }, select: { orderId: true, productIdSnapshot: true, productNameSnapshot: true, variantId: true } }),
    creditedChannels([...new Set(rows.map((r) => r.sessionId).filter((s): s is string => Boolean(s)))]),
  ]);
  const productsOf = new Map<string, Array<{ id: string; name: string }>>();
  for (const i of items) {
    const list = productsOf.get(i.orderId) ?? [];
    const id = i.productIdSnapshot ?? `variant:${i.variantId}`;
    if (!list.some((p) => p.id === id)) list.push({ id, name: i.productNameSnapshot });
    productsOf.set(i.orderId, list);
  }
  const minor = (v: Prisma.Decimal) => fromMajor(v.toString(), currency).amount;
  return rows.map((r) => {
    const c = r.sessionId ? credit.get(r.sessionId) : undefined;
    return {
      orderId: r.id,
      bookedAt: r.booked,
      endedAt: r.ended,
      outcome: r.outcome,
      district: r.district,
      division: r.division,
      paymentMethod: r.paymentMethod,
      value: minor(r.total),
      codValue: minor(r.cod),
      phone: r.phone,
      customerName: r.name,
      repeatCustomer: r.repeat,
      channel: c ? channelLabel(c.cls) : null,
      products: productsOf.get(r.id) ?? [],
    };
  });
}

export interface DeliveryOutcomesReport {
  range: { from: string; to: string };
  currency: string;
  totals: OutcomeTotals;
  previous: OutcomeTotals | null;
  byDistrict: BreakdownRow[];
  byDivision: BreakdownRow[];
  byProduct: Array<BreakdownRow & { productId: string }>;
  byPayment: BreakdownRow[];
  byValue: BreakdownRow[];
  byCustomer: BreakdownRow[];
  byChannel: BreakdownRow[];
  weekly: ReturnType<typeof weeklyTrend>;
  repeatRefusers: RepeatRefuser[];
  minParcels: number;
}


export async function getDeliveryOutcomes(days?: number, dateFrom?: Date, dateTo?: Date): Promise<DeliveryOutcomesReport> {
  const range = await resolveLegacyWindow(days, dateFrom, dateTo);
  const { currency } = await storeContext();
  const key = `analytics:v1:delivery-outcomes:${range.timezone}:${range.startUtc.toISOString()}:${range.endUtc.toISOString()}`;
  const hit = await cacheGet<DeliveryOutcomesReport>(key);
  if (hit) return hit;

  const [parcels, before] = await Promise.all([loadParcels(range, currency), range.preset === "lifetime" ? Promise.resolve(null) : loadParcels(previousRange(range), currency)]);
  const major = (v: number) => toMajor(money(v, currency));
  const totalsOut = (t: OutcomeTotals): OutcomeTotals => ({ ...t, refusedCodValue: major(t.refusedCodValue) });
  const productName = new Map(parcels.flatMap((p) => p.products.map((x) => [x.id, x.name] as const)));

  const report: DeliveryOutcomesReport = {
    range: { from: range.from, to: range.to },
    currency,
    totals: totalsOut(outcomeTotals(parcels)),
    previous: before ? totalsOut(outcomeTotals(before)) : null,
    byDistrict: breakdown(parcels, (p) => [p.district], { minParcels: MIN_PARCELS, limit: 64 }),
    byDivision: breakdown(parcels, (p) => [p.division]),
    byProduct: breakdown(parcels, (p) => p.products.map((x) => x.id), { minParcels: MIN_PARCELS, limit: 50 }).map((r) => ({ ...r, productId: r.key, key: productName.get(r.key) ?? r.key })),
    byPayment: breakdown(parcels, (p) => [p.paymentMethod === "COD" ? "Cash on delivery" : "Paid in advance"]),
    byValue: breakdown(parcels, (p) => [valueBand(p.value, currency)]).sort((a, b) => valueBands(currency).indexOf(a.key) - valueBands(currency).indexOf(b.key)),
    byCustomer: breakdown(parcels, (p) => [p.repeatCustomer ? "Returning customer" : "First order"]),
    byChannel: breakdown(parcels, (p) => [p.channel ?? "No website visit (phone, admin)"]),
    weekly: weeklyTrend(parcels, range.timezone),
    repeatRefusers: repeatRefusers(parcels).map((r) => ({ ...r, refusedCodValue: major(r.refusedCodValue) })),
    minParcels: MIN_PARCELS,
  };
  await cacheSet(key, report, CACHE_TTL_SECONDS);
  return report;
}
