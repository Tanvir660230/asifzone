import { normalizeBdPhone } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import type { PendingCheckoutPayload } from "./payment.service";

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
  // orderNumber is null for a failed storefront digital-payment checkout — no Order is ever
  // created for those (see payment.service.ts's markPaymentSessionFailed), so this Payment row is
  // the only trace of the attempt.
  recentFailures: Array<{ orderNumber: string | null; provider: string; failedAt: string }>;
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
      orderNumber: p.order?.orderNumber ?? null,
      provider: p.provider,
      failedAt: p.settledAt.toISOString(),
    })),
    refundsThisMonthCount: refundAgg._count,
    refundsThisMonthAmount: Number(refundAgg._sum.amount ?? 0),
  };

  await cacheSet(CACHE_KEY, overview, CACHE_TTL_SECONDS);
  return overview;
}

export interface PaymentAttemptSearchResult {
  sessionId: string;
  provider: string;
  status: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  amount: number;
  orderId: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  paymentTxnStatus: string | null;
  lastEventNote: string | null;
}

/** Support's answer to "a customer called saying their payment failed/didn't go through" —
 * PaymentSession is the only record of an attempt that never became an Order (a FAILED/
 * CANCELLED/EXPIRED pre-order digital-payment checkout, see payment.service.ts's
 * initiatePendingPayment), so an order-number or order-list search can't find it. The customer's
 * phone was snapshotted into checkoutPayload at checkout-initiation even for those, which is what
 * this searches — normalized through the same normalizeBdPhone every stored phone already went
 * through, so "+8801999454749", "01999454749", and "1999454749" all match the same rows. */
export async function searchPaymentAttempts(phoneQuery: string): Promise<PaymentAttemptSearchResult[]> {
  const phone = normalizeBdPhone(phoneQuery);
  if (phone.length < 4) return [];

  const sessions = await prisma.paymentSession.findMany({
    where: {
      OR: [
        { order: { customerPhone: { contains: phone } } },
        { checkoutPayload: { path: ["input", "customerPhone"], string_contains: phone } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      order: { select: { id: true, orderNumber: true, status: true, customerName: true, customerPhone: true, total: true } },
      payment: { select: { status: true } },
      events: { orderBy: { createdAt: "desc" }, take: 1, select: { type: true, note: true } },
    },
  });

  return sessions.map((s) => {
    const payload = s.order ? null : (s.checkoutPayload as unknown as PendingCheckoutPayload | null);
    const lastEvent = s.events[0];
    return {
      sessionId: s.id,
      provider: s.provider,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      customerName: s.order?.customerName ?? payload?.input.customerName ?? "",
      customerPhone: s.order?.customerPhone ?? payload?.input.customerPhone ?? "",
      amount: s.order ? Number(s.order.total) : (payload?.pricing.total ?? 0),
      orderId: s.order?.id ?? null,
      orderNumber: s.order?.orderNumber ?? null,
      orderStatus: s.order?.status ?? null,
      paymentTxnStatus: s.payment?.status ?? null,
      lastEventNote: lastEvent ? (lastEvent.note ?? lastEvent.type) : null,
    };
  });
}
