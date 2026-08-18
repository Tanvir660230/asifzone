import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";

const CACHE_TTL_SECONDS = 60;
const CACHE_KEY = "payments:overview";

export interface PaymentsOverview {
  attemptsToday: number;
  attemptsTodayByProvider: Array<{ provider: string; count: number }>;
  successRateTodayPct: number;
  activeSessionsCount: number;
  // ACTIVE EPS sessions past the reconciliation cron's own 3-minute settle-grace — roughly "what
  // the next sweep is about to work through", not a backlog the cron has fallen behind on.
  epsReconciliationQueueDepth: number;
  cancelledButPaidCount: number;
  recentFailures: Array<{ orderNumber: string; provider: string; failedAt: string }>;
  refundsThisMonthCount: number;
  refundsThisMonthAmount: number;
}

/** Mirrors bi.service.ts's getExecutiveOverview pattern exactly: one Redis-cached (60s) aggregate
 * built from parallel queries, served by a thin requireAdmin-guarded router. */
export async function getPaymentsOverview(): Promise<PaymentsOverview> {
  const cached = await cacheGet<PaymentsOverview>(CACHE_KEY);
  if (cached) return cached;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const reconciliationGrace = new Date(now.getTime() - 3 * 60 * 1000);

  const [
    attemptsTodayByProvider,
    succeededToday,
    failedToday,
    activeSessionsCount,
    epsReconciliationQueueDepth,
    cancelledButPaidCount,
    recentFailedPayments,
    refundAgg,
  ] = await Promise.all([
    prisma.paymentSession.groupBy({ by: ["provider"], where: { createdAt: { gte: startOfToday } }, _count: true }),
    prisma.payment.count({ where: { status: "SUCCEEDED", settledAt: { gte: startOfToday } } }),
    prisma.payment.count({ where: { status: "FAILED", settledAt: { gte: startOfToday } } }),
    prisma.paymentSession.count({ where: { status: "ACTIVE" } }),
    prisma.paymentSession.count({
      where: { provider: "EPS_PG", status: "ACTIVE", createdAt: { lte: reconciliationGrace } },
    }),
    prisma.order.count({ where: { deletedAt: null, status: "CANCELLED", paymentStatus: "PAID" } }),
    prisma.payment.findMany({
      where: { status: "FAILED" },
      orderBy: { settledAt: "desc" },
      take: 10,
      select: { provider: true, settledAt: true, order: { select: { orderNumber: true } } },
    }),
    prisma.refund.aggregate({
      where: { status: "COMPLETED", completedAt: { gte: startOfMonth } },
      _count: true,
      _sum: { amount: true },
    }),
  ]);

  const settledToday = succeededToday + failedToday;
  const attemptsToday = attemptsTodayByProvider.reduce((sum, g) => sum + g._count, 0);

  const overview: PaymentsOverview = {
    attemptsToday,
    attemptsTodayByProvider: attemptsTodayByProvider.map((g) => ({ provider: g.provider, count: g._count })),
    successRateTodayPct: settledToday > 0 ? (succeededToday / settledToday) * 100 : 0,
    activeSessionsCount,
    epsReconciliationQueueDepth,
    cancelledButPaidCount,
    recentFailures: recentFailedPayments.map((p) => ({
      orderNumber: p.order.orderNumber,
      provider: p.provider,
      failedAt: p.settledAt.toISOString(),
    })),
    refundsThisMonthCount: refundAgg._count,
    refundsThisMonthAmount: Number(refundAgg._sum.amount ?? 0),
  };

  await cacheSet(CACHE_KEY, overview, CACHE_TTL_SECONDS);
  return overview;
}
