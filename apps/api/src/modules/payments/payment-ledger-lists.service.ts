import type { Prisma } from "@prisma/client";
import type { PaymentTransactionListQuery, PaymentTransactionRow, RefundListQuery, RefundRow } from "@clothing-brand/shared";
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
