import type { OrderStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";

const CACHE_TTL_SECONDS = 300;
const NON_REVENUE_STATUSES: OrderStatus[] = ["CANCELLED"];

/** Daily order count + gross order value for the last N days, zero-filled so the chart has no gaps. */
export async function getRevenueSeries(days = 30) {
  const cacheKey = `analytics:revenue:${days}`;
  const cached = await cacheGet<Array<{ date: string; revenue: number; orders: number }>>(cacheKey);
  if (cached) return cached;

  // UTC throughout, so the day-keys generated here always match Postgres's UTC-based date_trunc,
  // regardless of the Node process's local timezone.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.$queryRaw<Array<{ day: Date; revenue: number; orders: bigint }>>`
    SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day,
           COALESCE(SUM(total), 0)::float AS revenue,
           COUNT(*)::bigint AS orders
    FROM "Order"
    WHERE "createdAt" >= ${since} AND status != 'CANCELLED'
    GROUP BY day
    ORDER BY day ASC
  `;

  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), { revenue: r.revenue, orders: Number(r.orders) }]));

  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const point = byDay.get(key);
    series.push({ date: key, revenue: point?.revenue ?? 0, orders: point?.orders ?? 0 });
  }

  await cacheSet(cacheKey, series, CACHE_TTL_SECONDS);
  return series;
}

export async function getOrderStatusCounts() {
  const cacheKey = "analytics:status-counts";
  const cached = await cacheGet<Array<{ status: string; count: number }>>(cacheKey);
  if (cached) return cached;

  const grouped = await prisma.order.groupBy({ by: ["status"], _count: { _all: true } });
  const result = grouped.map((g) => ({ status: g.status, count: g._count._all }));

  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

export async function getTopProducts(days = 30, limit = 5) {
  const cacheKey = `analytics:top-products:${days}:${limit}`;
  const cached = await cacheGet<Array<{ name: string; quantitySold: number; revenue: number }>>(cacheKey);
  if (cached) return cached;

  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await prisma.$queryRaw<Array<{ name: string; quantitySold: bigint; revenue: number }>>`
    SELECT oi."productNameSnapshot" AS name,
           SUM(oi.quantity)::bigint AS "quantitySold",
           SUM(oi.quantity * oi."priceSnapshot")::float AS revenue
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE o."createdAt" >= ${since} AND o.status != 'CANCELLED'
    GROUP BY oi."productNameSnapshot"
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  const result = rows.map((r) => ({ name: r.name, quantitySold: Number(r.quantitySold), revenue: r.revenue }));
  await cacheSet(cacheKey, result, CACHE_TTL_SECONDS);
  return result;
}

export async function getLowStockVariants(threshold = 5, limit = 20) {
  return prisma.productVariant.findMany({
    where: { stock: { lte: threshold }, product: { isActive: true } },
    include: { product: { select: { name: true, slug: true } } },
    orderBy: { stock: "asc" },
    take: limit,
  });
}

export async function getDashboardSummary() {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const prevSince = new Date();
  prevSince.setDate(prevSince.getDate() - 60);

  const [revenueAgg, orderCount, prevRevenueAgg, prevOrderCount, pendingCount, lowStockCount] = await Promise.all([
    prisma.order.aggregate({
      where: { createdAt: { gte: since }, status: { notIn: NON_REVENUE_STATUSES } },
      _sum: { total: true },
    }),
    prisma.order.count({ where: { createdAt: { gte: since }, status: { notIn: NON_REVENUE_STATUSES } } }),
    // Prior 30-day window (day -60 to -30) — the baseline the dashboard's trend deltas compare against.
    prisma.order.aggregate({
      where: { createdAt: { gte: prevSince, lt: since }, status: { notIn: NON_REVENUE_STATUSES } },
      _sum: { total: true },
    }),
    prisma.order.count({ where: { createdAt: { gte: prevSince, lt: since }, status: { notIn: NON_REVENUE_STATUSES } } }),
    prisma.order.count({ where: { status: "PENDING" } }),
    prisma.productVariant.count({ where: { stock: { lte: 5 }, product: { isActive: true } } }),
  ]);

  return {
    revenue30d: Number(revenueAgg._sum?.total ?? 0),
    orders30d: orderCount,
    revenuePrev30d: Number(prevRevenueAgg._sum?.total ?? 0),
    ordersPrev30d: prevOrderCount,
    pendingOrders: pendingCount,
    lowStockCount,
  };
}
