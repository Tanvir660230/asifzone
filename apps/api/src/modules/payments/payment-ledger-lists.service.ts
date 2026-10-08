import type { Prisma } from "@prisma/client";
import { normalizeBdPhone } from "@clothing-brand/shared";
import type {
  PaymentSessionListQuery,
  PaymentSessionRow,
  PaymentTransactionListQuery,
  PaymentTransactionRow,
  RefundListQuery,
  RefundRow,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { paginate } from "../../lib/paginate";

/**
 * Finance › Transactions and Refunds (Blueprint V2 §M) — read-only lists over the payment ledger's Payment and Refund
 * rows. Every write to those rows stays in payment-ledger.service.ts (I24); these only read, newest first.
 */

const orderRef = { select: { id: true, orderNumber: true, customerName: true, customerPhone: true } } as const;

function orderSearch(search: string | undefined): Prisma.OrderWhereInput | undefined {
  if (!search) return undefined;
  return {
    OR: [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { customerName: { contains: search, mode: "insensitive" } },
      { customerPhone: { contains: search } },
    ],
  };
}

function between(from?: Date, to?: Date) {
  return from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
}

/**
 * Finance › Online attempts (Blueprint V2 P5): gateway checkout sessions, newest first — including storefront checkouts
 * that failed or were abandoned before any order existed (their customer comes from the checkout snapshot). Read-only.
 */
export async function listPaymentSessions(query: PaymentSessionListQuery) {
  const s = query.search;
  // A phone typed any way (+880…, 01…) matches the stored local form.
  const phone = s && /^[+\d\s-]{4,}$/.test(s) ? normalizeBdPhone(s) : s;
  const where: Prisma.PaymentSessionWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.provider ? { provider: query.provider } : {}),
    ...(between(query.from, query.to) ? { createdAt: between(query.from, query.to) } : {}),
    ...(s
      ? {
          OR: [
            { gatewayTransactionRef: { contains: s, mode: "insensitive" } },
            { providerTransactionId: { contains: s, mode: "insensitive" } },
            { order: orderSearch(s) },
            ...(phone ? [{ order: { customerPhone: { contains: phone } } }] : []),
            // A checkout that never became an order: the customer is in its snapshot (PendingCheckoutPayload).
            { checkoutPayload: { path: ["input", "customerPhone"], string_contains: phone } },
            { checkoutPayload: { path: ["input", "customerName"], string_contains: s } },
          ],
        }
      : {}),
  };
  const page = await paginate(
    query,
    (p) =>
      prisma.paymentSession.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...p,
        select: {
          id: true,
          provider: true,
          status: true,
          amount: true,
          gatewayTransactionRef: true,
          providerTransactionId: true,
          createdAt: true,
          expiresAt: true,
          checkoutPayload: true,
          paymentLinkId: true,
          orderModificationId: true,
          order: { select: { id: true, orderNumber: true, customerName: true, customerPhone: true } },
          events: { orderBy: { createdAt: "desc" }, take: 1, select: { type: true, note: true, createdAt: true } },
        },
      }),
    () => prisma.paymentSession.count({ where }),
  );
  const items: PaymentSessionRow[] = page.items.map((r) => {
    const snapshot = ((r.checkoutPayload ?? {}) as { input?: { customerName?: string; customerPhone?: string }; pricing?: { total?: number } });
    const event = r.events[0];
    return {
      id: r.id,
      provider: r.provider as PaymentSessionRow["provider"],
      status: r.status,
      amount: r.amount !== null ? Number(r.amount) : (snapshot.pricing?.total ?? null),
      gatewayRef: r.gatewayTransactionRef,
      providerTransactionId: r.providerTransactionId,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      order: r.order ? { id: r.order.id, orderNumber: r.order.orderNumber } : null,
      customerName: r.order?.customerName ?? snapshot.input?.customerName ?? null,
      customerPhone: r.order?.customerPhone ?? snapshot.input?.customerPhone ?? null,
      source: r.paymentLinkId ? "payment_link" : r.orderModificationId ? "modification" : r.checkoutPayload ? "checkout" : "order",
      lastEvent: event ? { type: event.type, note: event.note, at: event.createdAt.toISOString() } : null,
    };
  });
  return { ...page, items };
}

export async function listPaymentTransactions(query: PaymentTransactionListQuery) {
  const order = orderSearch(query.search);
  const where: Prisma.PaymentWhereInput = {
    ...(query.provider ? { provider: query.provider } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(between(query.from, query.to) ? { settledAt: between(query.from, query.to) } : {}),
    ...(order ? { order } : {}),
  };
  const page = await paginate(
    query,
    (p) =>
      prisma.payment.findMany({
        where,
        orderBy: { settledAt: "desc" },
        include: { order: orderRef, recordedByAdmin: { select: { name: true } } },
        ...p,
      }),
    () => prisma.payment.count({ where }),
  );
  const items: PaymentTransactionRow[] = page.items.map((p) => ({
    id: p.id,
    settledAt: p.settledAt.toISOString(),
    provider: p.provider,
    status: p.status,
    amount: Number(p.amount),
    providerTransactionId: p.providerTransactionId,
    note: p.note,
    recordedBy: p.recordedByAdmin?.name ?? null,
    order: p.order,
  }));
  return { ...page, items };
}

export async function listRefunds(query: RefundListQuery) {
  const order = orderSearch(query.search);
  const where: Prisma.RefundWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(between(query.from, query.to) ? { createdAt: between(query.from, query.to) } : {}),
    ...(order ? { order } : {}),
  };
  const page = await paginate(
    query,
    (p) =>
      prisma.refund.findMany({
        where,
        // Waiting refunds first (they need a person), then newest.
        orderBy: [{ status: "desc" }, { createdAt: "desc" }],
        include: { order: orderRef, requestedByAdmin: { select: { name: true } }, completedByAdmin: { select: { name: true } } },
        ...p,
      }),
    () => prisma.refund.count({ where }),
  );
  const items: RefundRow[] = page.items.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    status: r.status,
    amount: Number(r.amount),
    reason: r.reason,
    method: r.method,
    requestedBy: r.requestedByAdmin?.name ?? null,
    completedBy: r.completedByAdmin?.name ?? null,
    order: r.order,
  }));
  return { ...page, items };
}
