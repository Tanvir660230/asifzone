/**
 * The customer store-balance ledger (docs/ORDER_ADJUSTMENTS.md §4) — the ONLY code that writes `CustomerCreditEntry`
 * (architecture guard: customer-credit-writer.guard.test.ts).
 *
 *   facts     CustomerCreditEntry rows, append-only (a DB trigger refuses any change to customer/type/amount/currency/key)
 *   balance   Σ amount for the customer — derived on every read, never stored; computed under the Customer row lock
 *             (SELECT … FOR UPDATE) whenever balance is spent, so concurrent checkouts serialise and can't overspend
 *   policy    store-use only: no withdrawal, no transfer, no expiry. Spendable on any order the account holder places
 *             (storefront checkout or a staff-entered order for that customer), for merchandise and shipping alike,
 *             alongside coupons, and as a partial payment with COD or a gateway paying the rest
 *
 * Every row has a server-derived idempotency key (`credit:<what>:<id>:<step>`), so a retried command — a double click, a
 * webhook redelivery, a repeated cancellation — finds the row it already wrote instead of adding another. WHEN credit may be
 * issued and HOW MUCH (never more than the order's refund due) is decided by the payment ledger
 * (payment-ledger.service.ts), which calls in here under the order row lock.
 */
import { Prisma, type CustomerCreditType } from "@prisma/client";
import { fromMajor, toMajor, type Money, type StoreCreditSummary } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";

type Db = Prisma.TransactionClient;

/** Entry types that move an order's money to the customer's balance (they count against that order's refund due). */
export const CREDIT_ISSUE_TYPES = ["CANCELLATION", "ORDER_MODIFICATION", "RETURN", "EXCHANGE", "REFUND_TO_CREDIT"] as const satisfies readonly CustomerCreditType[];
export type CreditIssueType = (typeof CREDIT_ISSUE_TYPES)[number];

export const sessionReserveKey = (paymentSessionId: string) => `credit:session:${paymentSessionId}:reserve`;
const sessionReleaseKey = (paymentSessionId: string) => `credit:session:${paymentSessionId}:release`;

interface NewEntry {
  customerId: string;
  type: CustomerCreditType;
  /** Signed: positive adds balance, negative (ORDER_PAYMENT only) spends it. */
  amount: Money;
  reason: string;
  orderId?: string | null;
  sourceType: string;
  sourceId: string;
  paymentId?: string | null;
  idempotencyKey: string;
  adminId?: string | null;
}

/** Inserts the entry once per idempotency key. ON CONFLICT DO NOTHING keeps a duplicate from aborting the caller's
 * transaction; the stored row is then returned, and a key reused for a different customer/amount is refused. */
async function append(tx: Db, e: NewEntry) {
  if (e.amount.amount === 0) throw new Error("A store-credit entry can't be zero");
  await tx.customerCreditEntry.createMany({
    data: [
      {
        customerId: e.customerId,
        type: e.type,
        amount: toMajor(e.amount),
        currency: e.amount.currency,
        reason: e.reason,
        orderId: e.orderId ?? null,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        paymentId: e.paymentId ?? null,
        idempotencyKey: e.idempotencyKey,
        createdByAdminId: e.adminId ?? null,
      },
    ],
    skipDuplicates: true,
  });
  const row = await tx.customerCreditEntry.findUniqueOrThrow({ where: { idempotencyKey: e.idempotencyKey } });
  if (row.customerId !== e.customerId || fromMajor(row.amount.toString(), e.amount.currency).amount !== e.amount.amount) {
    throw AppError.conflict("This store-credit operation was already recorded with different details");
  }
  return row;
}

async function sumBalance(db: Db | typeof prisma, customerId: string, currency: string): Promise<Money> {
  const agg = await db.customerCreditEntry.aggregate({ where: { customerId }, _sum: { amount: true } });
  return fromMajor((agg._sum.amount ?? 0).toString(), currency);
}

/** Takes the customer row lock and returns the balance it protects. Every spend runs after this in its transaction.
 * FOR NO KEY UPDATE, not FOR UPDATE: it still serialises every balance writer (and the loyalty writers' FOR UPDATE), but it
 * does not conflict with the KEY SHARE lock an order insert's customer foreign-key check takes — with FOR UPDATE, two
 * concurrent checkouts of one customer deadlock (each holds KEY SHARE from its order insert and waits for the other). */
export async function lockCustomerBalance(tx: Db, customerId: string, currency: string): Promise<Money> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Customer" WHERE id = ${customerId} FOR NO KEY UPDATE`;
  if (!rows.length) throw AppError.notFound("Customer not found");
  return sumBalance(tx, customerId, currency);
}

/** Read-only balance (display). Spending re-reads it under the lock. */
export async function storeCreditBalance(customerId: string, currency: string, db: Db | typeof prisma = prisma): Promise<Money> {
  return sumBalance(db, customerId, currency);
}

/** Adds balance from an order's money. The caller (payment ledger) has validated the amount against the order's refund due
 * under the order row lock. Idempotent per key. */
export async function issueCredit(
  tx: Db,
  e: Omit<NewEntry, "type" | "paymentId"> & { type: CreditIssueType | "ORDER_PAYMENT_RELEASED" },
) {
  if (e.amount.amount <= 0) throw AppError.badRequest("Store credit must be positive");
  await lockCustomerBalance(tx, e.customerId, e.amount.currency);
  return append(tx, e);
}

/** Spends balance: refused (409 INSUFFICIENT_STORE_CREDIT) when the balance under the lock is lower than `amount`. Idempotent
 * per key — a replay returns the spend already recorded without checking the balance again. */
export async function spendCredit(tx: Db, e: Omit<NewEntry, "type" | "amount"> & { amount: Money }) {
  if (e.amount.amount <= 0) throw AppError.badRequest("A store-credit payment must be positive");
  const existing = await tx.customerCreditEntry.findUnique({ where: { idempotencyKey: e.idempotencyKey } });
  if (existing) return existing;
  const balance = await lockCustomerBalance(tx, e.customerId, e.amount.currency);
  if (balance.amount < e.amount.amount) {
    throw new AppError(409, "Your store balance has changed — please review your order", {
      code: "INSUFFICIENT_STORE_CREDIT",
      balance: toMajor(balance),
    });
  }
  return append(tx, { ...e, type: "ORDER_PAYMENT", amount: { ...e.amount, amount: -e.amount.amount } });
}

/** The session's reservation if it can still become a payment — not consumed, not given back. Takes the customer lock,
 * so the answer holds for the rest of the caller's transaction. */
export async function claimableReservation(tx: Db, paymentSessionId: string) {
  const reserve = await tx.customerCreditEntry.findUnique({ where: { idempotencyKey: sessionReserveKey(paymentSessionId) } });
  if (!reserve) return null;
  await lockCustomerBalance(tx, reserve.customerId, reserve.currency);
  const [current, released] = await Promise.all([
    tx.customerCreditEntry.findUniqueOrThrow({ where: { id: reserve.id } }),
    tx.customerCreditEntry.findUnique({ where: { idempotencyKey: sessionReleaseKey(paymentSessionId) } }),
  ]);
  return current.paymentId || released ? null : current;
}

/** A gateway checkout's reserved spend becomes the STORE_CREDIT payment of the order it paid for: the one update the ledger
 * allows (order/payment links, set once). Null when the reservation was already consumed or released. */
export async function consumeSessionReservation(tx: Db, paymentSessionId: string, link: { orderId: string; paymentId: string }) {
  const reserve = await claimableReservation(tx, paymentSessionId);
  if (!reserve) return null;
  const claimed = await tx.customerCreditEntry.updateMany({ where: { id: reserve.id, paymentId: null }, data: link });
  return claimed.count === 1 ? reserve : null;
}

/** Gives back what a gateway checkout reserved when the attempt failed, was cancelled or expired. Once only (its own key),
 * and never after the reservation became a payment. */
export async function releaseSessionReservation(tx: Db, paymentSessionId: string, reason: string) {
  const reserve = await tx.customerCreditEntry.findUnique({ where: { idempotencyKey: sessionReserveKey(paymentSessionId) } });
  if (!reserve) return null;
  await lockCustomerBalance(tx, reserve.customerId, reserve.currency);
  const current = await tx.customerCreditEntry.findUniqueOrThrow({ where: { id: reserve.id } });
  if (current.paymentId) return null;
  return append(tx, {
    customerId: reserve.customerId,
    type: "ORDER_PAYMENT_RELEASED",
    amount: fromMajor(reserve.amount.abs().toString(), reserve.currency),
    reason,
    orderId: null,
    sourceType: "PAYMENT_SESSION",
    sourceId: paymentSessionId,
    idempotencyKey: sessionReleaseKey(paymentSessionId),
  });
}

/** The reservation a gateway checkout holds, if any (its amount is negative). */
export async function sessionReservation(db: Db | typeof prisma, paymentSessionId: string) {
  return db.customerCreditEntry.findUnique({ where: { idempotencyKey: sessionReserveKey(paymentSessionId) } });
}

/** Σ credit issued from each order's money — the payment ledger's `credits` input. */
export async function creditedByOrder(db: Db | typeof prisma, orderIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  if (!orderIds.length) return new Map();
  const rows = await db.customerCreditEntry.groupBy({
    by: ["orderId"],
    where: { orderId: { in: orderIds }, type: { in: [...CREDIT_ISSUE_TYPES] } },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.orderId!, r._sum.amount ?? new Prisma.Decimal(0)]));
}

export async function creditEntriesForOrders(db: Db | typeof prisma, orderIds: string[]) {
  if (!orderIds.length) return [];
  return db.customerCreditEntry.findMany({
    where: { orderId: { in: orderIds }, type: { in: [...CREDIT_ISSUE_TYPES] } },
    include: { createdByAdmin: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** The customer's balance and history (account page, checkout, admin customer view). */
export async function getStoreCreditSummary(customerId: string, currency: string, opts: { limit?: number } = {}): Promise<StoreCreditSummary> {
  const [balance, entries] = await Promise.all([
    sumBalance(prisma, customerId, currency),
    prisma.customerCreditEntry.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 }),
  ]);
  const orderIds = [...new Set(entries.map((e) => e.orderId).filter((id): id is string => Boolean(id)))];
  const orders = orderIds.length ? await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } }) : [];
  const numbers = new Map(orders.map((o) => [o.id, o.orderNumber]));
  return {
    currency,
    balance: toMajor(balance),
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      amount: Number(e.amount),
      reason: e.reason,
      orderId: e.orderId,
      orderNumber: e.orderId ? (numbers.get(e.orderId) ?? null) : null,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
