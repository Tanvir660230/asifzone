/**
 * The sale-order predicate (TARGET §11 SALE_ORDER, docs/METRICS_REGISTRY.md §2) in query form, for the few count-style
 * reads that don't load facts (storefront urgency/trending, session conversion). It must match the engine's
 * `isSaleOrder` exactly — metrics.integration.test.ts asserts both forms select the same orders. "Cancelled" is the current
 * status OR any CANCELLED history entry (the state machine allows CANCELLED → REFUNDED).
 */
import { Prisma } from "@prisma/client";

/** Not trashed, never cancelled, not an exchange replacement. */
export const SALE_ORDER_WHERE = {
  deletedAt: null,
  status: { not: "CANCELLED" },
  statusHistory: { none: { status: "CANCELLED" } },
  exchangeReturnRequests: { none: {} },
} satisfies Prisma.OrderWhereInput;

/** Any status, not trashed, not an exchange replacement (status breakdowns, cancellation counts). */
export const OPERATIONAL_ORDER_WHERE = {
  deletedAt: null,
  exchangeReturnRequests: { none: {} },
} satisfies Prisma.OrderWhereInput;

/** SALE_ORDER as a raw-SQL condition on an "Order" alias (for the remaining behavioural queries that join orders). */
export function saleOrderSql(alias: string): Prisma.Sql {
  const a = Prisma.raw(alias);
  return Prisma.sql`${a}."deletedAt" IS NULL AND ${a}.status <> 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM "OrderStatusHistory" sh WHERE sh."orderId" = ${a}.id AND sh.status = 'CANCELLED') AND NOT EXISTS (SELECT 1 FROM "ReturnRequest" rr WHERE rr."exchangeOrderId" = ${a}.id)`;
}
