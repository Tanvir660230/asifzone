/**
 * Order COD risk loader (docs/METRICS_REGISTRY.md §4.8). For each order: the same phone's EARLIER orders at this store
 * (phones compared on their last 11 digits, so +880 / 880 / 01… spellings match), each classified by the §4.7 outcome
 * rule — delivered / partial / refused (CANCELLED at or after booking, or RETURNED) — or cancelled before booking, or
 * still open; plus the customer's cached courier score. Trashed orders and exchange replacements are left out.
 */
import { Prisma } from "@prisma/client";
import { fromMajor, money, toMajor } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { storeContext } from "../../domain/metrics/store-time";
import { orderRisk, type OrderRisk, type PhoneHistory } from "./order-risk";

export const MAX_ORDERS_PER_REQUEST = 100;

interface HistoryRow {
  target: string;
  delivered: bigint;
  partial: bigint;
  refused: bigint;
  cancelled: bigint;
  open: bigint;
  refused_cod: Prisma.Decimal | null;
}

export interface OrderRiskResult extends OrderRisk {
  history: PhoneHistory;
}

const phoneKey = (alias: string) => Prisma.raw(`right(regexp_replace(${alias}."customerPhone", '[^0-9]', '', 'g'), 11)`);

export async function getOrderRisk(orderIds: string[]): Promise<Record<string, OrderRiskResult>> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (ids.length > MAX_ORDERS_PER_REQUEST) throw AppError.badRequest(`At most ${MAX_ORDERS_PER_REQUEST} orders per request`);
  if (!ids.length) return {};
  const { currency } = await storeContext();

  const [orders, rows] = await Promise.all([
    prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true, total: true, customer: { select: { deliverySuccessRate: true } } } }),
    prisma.$queryRaw<HistoryRow[]>`
      WITH target AS (
        SELECT o.id, o."createdAt", ${phoneKey("o")} AS phone FROM "Order" o WHERE o.id = ANY(${ids})
      ), hist AS (
        SELECT t.id AS target, e.status::text AS status, e."courierBookedAt" AS booked,
          (SELECT MIN(h."createdAt") FROM "OrderStatusHistory" h WHERE h."orderId" = e.id AND h.status = 'DELIVERED') AS d_at,
          (SELECT MIN(h."createdAt") FROM "OrderStatusHistory" h WHERE h."orderId" = e.id AND h.status = 'PARTIALLY_DELIVERED') AS p_at,
          (SELECT MIN(h."createdAt") FROM "OrderStatusHistory" h WHERE h."orderId" = e.id
             AND (h.status = 'RETURNED' OR (h.status = 'CANCELLED' AND e."courierBookedAt" IS NOT NULL AND h."createdAt" >= e."courierBookedAt"))) AS r_at,
          CASE WHEN e."courierBookedAt" IS NULL THEN 0 ELSE
            GREATEST(e.total - COALESCE((SELECT SUM(p.amount) FROM "Payment" p WHERE p."orderId" = e.id AND p.purpose = 'ORDER' AND p.status = 'SUCCEEDED' AND p.provider <> 'COD' AND p."settledAt" <= e."courierBookedAt"), 0), 0)
          END AS cod
        FROM target t JOIN "Order" e ON ${phoneKey("e")} = t.phone AND e.id <> t.id AND e."createdAt" < t."createdAt"
        WHERE t.phone <> '' AND e."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "ReturnRequest" rr WHERE rr."exchangeOrderId" = e.id)
      ), classified AS (
        SELECT target, cod,
          CASE
            WHEN LEAST(d_at, p_at, r_at) IS NULL THEN CASE WHEN status = 'CANCELLED' THEN 'cancelled' ELSE 'open' END
            WHEN LEAST(d_at, p_at, r_at) = d_at THEN 'delivered'
            WHEN LEAST(d_at, p_at, r_at) = p_at THEN 'partial'
            ELSE 'refused'
          END AS outcome
        FROM hist
      )
      SELECT target,
        COUNT(*) FILTER (WHERE outcome = 'delivered')::bigint AS delivered,
        COUNT(*) FILTER (WHERE outcome = 'partial')::bigint AS partial,
        COUNT(*) FILTER (WHERE outcome = 'refused')::bigint AS refused,
        COUNT(*) FILTER (WHERE outcome = 'cancelled')::bigint AS cancelled,
        COUNT(*) FILTER (WHERE outcome = 'open')::bigint AS open,
        SUM(cod) FILTER (WHERE outcome = 'refused') AS refused_cod
      FROM classified GROUP BY target`,
  ]);

  const byTarget = new Map(rows.map((r) => [r.target, r]));
  const out: Record<string, OrderRiskResult> = {};
  for (const o of orders) {
    const r = byTarget.get(o.id);
    const refusedCodMinor = r?.refused_cod ? fromMajor(r.refused_cod.toString(), currency).amount : 0;
    const history: PhoneHistory = {
      delivered: Number(r?.delivered ?? 0),
      partial: Number(r?.partial ?? 0),
      refused: Number(r?.refused ?? 0),
      cancelledBeforeBooking: Number(r?.cancelled ?? 0),
      open: Number(r?.open ?? 0),
      refusedCodValue: refusedCodMinor,
    };
    const risk = orderRisk({ history, orderValue: fromMajor(o.total.toString(), currency).amount, courierSuccessRate: o.customer?.deliverySuccessRate ?? null });
    out[o.id] = { ...risk, history: { ...history, refusedCodValue: toMajor(money(refusedCodMinor, currency)) } };
  }
  return out;
}
