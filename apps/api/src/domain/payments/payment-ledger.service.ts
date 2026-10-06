/**
 * The Payment Ledger (docs/PAYMENT_LEDGER.md) — the ONLY code that writes `Payment` rows, `Refund` rows or the
 * `Order.paymentStatus` projection (architecture guard: payment-ledger-writer.guard.test.ts).
 *
 *   facts       Payment (every settlement: gateway, COD collected on delivery, MANUAL, STORE_CREDIT spent) · Refund
 *               (REQUESTED → COMPLETED) · store credit issued from the order's money (CustomerCreditEntry, written through
 *               domain/credit/customer-credit.service.ts — this service decides when and how much, under the order lock)
 *   engine      derivePaymentPosition (packages/shared/src/engines/payment-ledger.ts) — paid, refunded, credited, balance
 *               due, cash to collect, refundable, refund due, status
 *   projection  Order.paymentStatus, refreshed in the same transaction as the fact that changed it
 *
 * Every command takes the order row lock (SELECT … FOR UPDATE) before reading the position it validates against, so
 * concurrent money commands on one order serialise. Side effects (loyalty reversal) run after commit.
 */
import { Prisma, type PaymentProvider } from "@prisma/client";
import {
  canCompleteRefund,
  checkCreditIssue,
  checkManualPayment,
  CLOSED_ORDER_STATUSES,
  checkRefund,
  derivePaymentPosition,
  fromMajor,
  min,
  toMajor,
  type Money,
  type PaymentPosition,
  type OrderPaymentSummary,
  type RecordPaymentInput,
  type RecordRefundInput,
  type CompleteRefundInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { loyaltyBase, reverseDeliveryPoints } from "../../modules/customers/customer.service";
import { getCurrency } from "../config/commerce-settings";
import {
  claimableReservation,
  consumeSessionReservation,
  creditedByOrder,
  creditEntriesForOrders,
  issueCredit,
  lockCustomerBalance,
  sessionReservation,
  spendCredit,
  type CreditIssueType,
} from "../credit/customer-credit.service";

type Db = Prisma.TransactionClient;

/** The refund queue: cancelled orders still holding customer money (MONEY_HELD_PAYMENT_STATUSES). One predicate for the
 * order list filter, the order KPI strip and the payments overview. */
export const REFUND_QUEUE_WHERE = { status: "CANCELLED", paymentStatus: { in: ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"] } } satisfies Prisma.OrderWhereInput;
/** The other half of the money-risk alerts (`order.returned_refund_due`): returned orders still holding customer money. */
export const RETURNED_REFUND_DUE_WHERE = { status: "RETURNED", paymentStatus: { in: ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"] } } satisfies Prisma.OrderWhereInput;

async function storeCurrency(): Promise<string> {
  return getCurrency();
}

function noteMoney(m: Money): string {
  return `${m.currency} ${toMajor(m).toFixed(2)}`;
}

interface LockedOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: Prisma.Decimal;
  deletedAt: Date | null;
  courierConsignmentId: string | null;
  customerId: string | null;
}

async function lockOrder(tx: Db, orderId: string): Promise<LockedOrder> {
  const [row] = await tx.$queryRaw<LockedOrder[]>`
    SELECT id, "orderNumber", status::text AS status, "paymentStatus"::text AS "paymentStatus", "paymentMethod"::text AS "paymentMethod",
           total, "deletedAt", "courierConsignmentId", "customerId"
    FROM "Order" WHERE id = ${orderId} FOR UPDATE
  `;
  if (!row) throw AppError.notFound("Order not found");
  return row;
}

type LedgerRows = {
  payments: Array<{ status: string; amount: Prisma.Decimal | number | string }>;
  refunds: Array<{ status: string; amount: Prisma.Decimal | number | string }>;
  /** Σ store credit issued from this order's money. */
  credited?: Prisma.Decimal | number | string;
  /** Σ allocated value of item-level returns (ReturnRequest.lines). */
  returned?: Prisma.Decimal | number | string;
};

/** Σ allocated value of the item-level returns recorded on each order (recordItemReturn writes `lines[].value`). */
export async function returnedValueByOrder(db: Db | typeof prisma, orderIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  const out = new Map<string, Prisma.Decimal>();
  if (!orderIds.length) return out;
  const rows = await db.returnRequest.findMany({ where: { orderId: { in: orderIds }, type: "RETURN", status: "APPROVED" }, select: { orderId: true, lines: true } });
  for (const r of rows) {
    if (!Array.isArray(r.lines)) continue;
    const value = (r.lines as Array<{ value?: number }>).reduce((acc, l) => acc.add(new Prisma.Decimal(l.value ?? 0)), new Prisma.Decimal(0));
    out.set(r.orderId, (out.get(r.orderId) ?? new Prisma.Decimal(0)).add(value));
  }
  return out;
}

/** The one place ledger rows become engine input. */
export function positionFromRows(
  order: { total: Prisma.Decimal | number | string; paymentMethod: string; status: string },
  rows: LedgerRows,
  currency: string,
): PaymentPosition {
  const m = (v: Prisma.Decimal | number | string) => fromMajor(v.toString(), currency);
  return derivePaymentPosition({
    currency,
    total: m(order.total),
    paymentMethod: order.paymentMethod,
    orderStatus: order.status,
    settlements: rows.payments.filter((p) => p.status === "SUCCEEDED").map((p) => m(p.amount)),
    failedAttempts: rows.payments.filter((p) => p.status === "FAILED").length,
    refundsCompleted: rows.refunds.filter((r) => r.status === "COMPLETED").map((r) => m(r.amount)),
    refundsRequested: rows.refunds.filter((r) => r.status === "REQUESTED").map((r) => m(r.amount)),
    credits: rows.credited ? [m(rows.credited)] : [],
    returned: rows.returned ? [m(rows.returned)] : [],
  });
}

async function loadPosition(db: Db | typeof prisma, order: { id: string; total: Prisma.Decimal; paymentMethod: string; status: string }, currency: string) {
  const [payments, refunds, credited, returned] = await Promise.all([
    db.payment.findMany({ where: { orderId: order.id }, select: { status: true, amount: true } }),
    db.refund.findMany({ where: { orderId: order.id }, select: { status: true, amount: true } }),
    creditedByOrder(db, [order.id]),
    returnedValueByOrder(db, [order.id]),
  ]);
  return positionFromRows(order, { payments, refunds, credited: credited.get(order.id), returned: returned.get(order.id) }, currency);
}

/** The position the order WOULD have with more merchandise returned — the engine's own answer for a preview (an item
 * return shows what it would credit before it is recorded). Read-only. */
export async function projectedPosition(db: Db | typeof prisma, orderId: string, change: { extraReturned: Money }) {
  const currency = await storeCurrency();
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, total: true, paymentMethod: true, status: true } });
  const [payments, refunds, credited, returned] = await Promise.all([
    db.payment.findMany({ where: { orderId }, select: { status: true, amount: true } }),
    db.refund.findMany({ where: { orderId }, select: { status: true, amount: true } }),
    creditedByOrder(db, [orderId]),
    returnedValueByOrder(db, [orderId]),
  ]);
  const extra = new Prisma.Decimal(toMajor(change.extraReturned));
  return positionFromRows(order, { payments, refunds, credited: credited.get(orderId), returned: (returned.get(orderId) ?? new Prisma.Decimal(0)).add(extra) }, currency);
}

/** The order's payment position read under the caller's order row lock (order modification, cancellation). */
export async function lockedPosition(tx: Db, orderId: string) {
  const order = await lockOrder(tx, orderId);
  return { order, position: await loadPosition(tx, order, await storeCurrency()) };
}

/** Recomputes the order's payment status from its ledger and writes the projection if it changed (PL-1). The caller
 * holds the order row lock. The only writer of Order.paymentStatus. */
export async function refreshPaymentStatus(tx: Db, orderId: string, currency?: string): Promise<PaymentPosition> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, total: true, paymentMethod: true, status: true, paymentStatus: true } });
  const position = await loadPosition(tx, order, currency ?? (await storeCurrency()));
  if (order.paymentStatus !== position.status) {
    await tx.order.update({ where: { id: orderId }, data: { paymentStatus: position.status } });
  }
  return position;
}

function timelineNote(tx: Db, orderId: string, status: string, note: string, adminId?: string | null) {
  return tx.orderStatusHistory.create({ data: { orderId, status: status as never, note, changedByAdminId: adminId ?? null } });
}

// ─── Settlements ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A verified gateway success (payment.service settlePaymentSession / insertOrderRecord for a pre-order session). One
 * Payment per session (unique paymentSessionId). A second session succeeding on a paid order is still recorded — the
 * money was taken — and surfaces as `overpaid` / `refundDue`. */
export async function recordGatewaySettlement(
  tx: Db,
  input: {
    orderId: string;
    paymentSessionId: string;
    provider: PaymentProvider;
    amount: number;
    verifiedAmount: number;
    providerTransactionId: string;
    rawResponse?: unknown;
  },
) {
  await lockOrder(tx, input.orderId);
  const payment = await tx.payment.create({
    data: {
      orderId: input.orderId,
      paymentSessionId: input.paymentSessionId,
      provider: input.provider,
      status: "SUCCEEDED",
      amount: input.amount,
      verifiedAmount: input.verifiedAmount,
      providerTransactionId: input.providerTransactionId,
      rawResponse: input.rawResponse as Prisma.InputJsonValue | undefined,
    },
  });
  const position = await refreshPaymentStatus(tx, input.orderId);
  return { payment, position };
}

/** A definitive gateway failure. A pre-order session (no Order yet) only leaves the row as its payment log. */
export async function recordFailedAttempt(
  tx: Db,
  input: { orderId: string | null; paymentSessionId: string; provider: PaymentProvider; amount: Prisma.Decimal | number; rawResponse?: unknown },
) {
  if (input.orderId) await lockOrder(tx, input.orderId);
  const payment = await tx.payment.create({
    data: {
      orderId: input.orderId,
      paymentSessionId: input.paymentSessionId,
      provider: input.provider,
      status: "FAILED",
      amount: input.amount,
      rawResponse: input.rawResponse as Prisma.InputJsonValue | undefined,
    },
  });
  if (input.orderId) await refreshPaymentStatus(tx, input.orderId);
  return payment;
}

/** Settles the order's whole balance due with one row of `provider` (0 allowed — a free exchange or a total-0 COD order
 * is still "settled"). Nothing is recorded when the order is already fully settled. Caller holds the lock. */
async function settleBalance(tx: Db, order: LockedOrder, provider: "COD" | "MANUAL", note: string, adminId?: string | null) {
  const currency = await storeCurrency();
  const position = await loadPosition(tx, order, currency);
  if (position.settled && position.amountDue.amount === 0) return { payment: null, position };
  const payment = await tx.payment.create({
    data: { orderId: order.id, provider, status: "SUCCEEDED", amount: toMajor(position.amountDue), note, recordedByAdminId: adminId ?? null },
  });
  return { payment, position: await refreshPaymentStatus(tx, order.id, currency) };
}

/** D1 at T4 (→ DELIVERED): the courier collected the balance due of a COD order at the door. Called by the order state
 * machine inside its transaction; a non-COD order is untouched. */
export async function recordCodCollection(tx: Db, orderId: string, actor: { adminId?: string | null } = {}) {
  const order = await lockOrder(tx, orderId);
  if (order.paymentMethod !== "COD") return null;
  return settleBalance(tx, order, "COD", "Cash collected on delivery (D1)", actor.adminId);
}

/** The admin "mark paid" of a manually entered order — inside that order's own insert transaction. */
export async function recordMarkedPaid(tx: Db, orderId: string, adminId: string) {
  const order = await lockOrder(tx, orderId);
  return settleBalance(tx, order, "MANUAL", "Marked paid when the order was entered", adminId);
}

/** A D6 exchange replacement whose price is fully covered by the returned item: settled at zero. */
export async function recordExchangeCovered(tx: Db, orderId: string, adminId: string) {
  const order = await lockOrder(tx, orderId);
  return settleBalance(tx, order, "MANUAL", "Exchange — fully covered by the returned item", adminId);
}

const CLOSED = new Set<string>(CLOSED_ORDER_STATUSES);

/** A payment staff record by hand (POST /orders/:id/payments). MANUAL: received out of band before dispatch; not on a
 * closed order, and not on a courier-booked COD order (its parcel's COD amount is fixed at booking). COD_COLLECTED: the
 * cash the courier collected on a partially delivered COD order. Always 0 < amount ≤ balance due. No status change. */
export async function recordManualPayment(orderId: string, input: RecordPaymentInput, adminId: string, idempotencyKey?: string | null) {
  if (idempotencyKey) {
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) return replayed(existing.orderId, orderId, existing);
  }
  const currency = await storeCurrency();
  try {
    const payment = await prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, orderId);
      if (order.deletedAt) throw AppError.badRequest("Restore this order before recording a payment");
      if (input.kind === "COD_COLLECTED") {
        if (order.paymentMethod !== "COD" || order.status !== "PARTIALLY_DELIVERED") {
          throw AppError.badRequest("Courier-collected cash is recorded only for a partially delivered Cash on Delivery order", { code: "PAYMENT_NOT_ALLOWED" });
        }
      } else {
        if (CLOSED.has(order.status)) throw AppError.badRequest(`Can't record a payment on an order that is ${order.status.toLowerCase()}`, { code: "PAYMENT_NOT_ALLOWED" });
        if (order.paymentMethod === "COD" && order.courierConsignmentId) {
          throw AppError.badRequest("The courier already has this parcel's COD amount — unlink the booking before recording a prepayment", { code: "PAYMENT_NOT_ALLOWED" });
        }
      }
      const amount = fromMajor(String(input.amount), currency);
      const position = await loadPosition(tx, order, currency);
      const check = checkManualPayment(position, amount);
      if (!check.ok) {
        throw AppError.badRequest(
          check.code === "EXCEEDS_AMOUNT_DUE" ? `Only ${noteMoney(check.amountDue)} is still due on this order` : "Amount must be positive",
          { code: "PAYMENT_EXCEEDS_AMOUNT_DUE", amountDue: toMajor(check.amountDue) },
        );
      }
      const note = [input.method, input.note].filter(Boolean).join(" — ") || null;
      const created = await tx.payment.create({
        data: {
          orderId,
          provider: input.kind === "COD_COLLECTED" ? "COD" : "MANUAL",
          status: "SUCCEEDED",
          amount: toMajor(amount),
          note,
          recordedByAdminId: adminId,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      await timelineNote(tx, orderId, order.status, `Payment recorded: ${noteMoney(amount)}${note ? ` (${note})` : ""}`, adminId);
      await refreshPaymentStatus(tx, orderId, currency);
      return created;
    });
    return { payment, summary: await getOrderPaymentSummary(orderId) };
  } catch (err) {
    if (idempotencyKey && isUniqueViolation(err)) {
      const winner = await prisma.payment.findUnique({ where: { idempotencyKey } });
      if (winner) return replayed(winner.orderId, orderId, winner);
    }
    throw err;
  }
}

// ─── Refunds ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Records money an admin already sent back (POST /orders/:id/refunds). Partial and repeated refunds are allowed up to
 * `refundable` (PL-2); the status becomes PARTIALLY_REFUNDED or REFUNDED (§4). D8 reversal after commit. */
export async function recordRefund(orderId: string, input: RecordRefundInput, adminId: string, idempotencyKey?: string | null) {
  if (idempotencyKey) {
    const existing = await prisma.refund.findUnique({ where: { idempotencyKey } });
    if (existing) return replayed(existing.orderId, orderId, existing, "refund");
  }
  const currency = await storeCurrency();
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, orderId);
      if (order.deletedAt) throw AppError.notFound("Order not found");
      const amount = fromMajor(String(input.amount), currency);
      const position = await loadPosition(tx, order, currency);
      if (position.refundable.amount === 0) {
        throw AppError.badRequest("Only a paid order can be refunded — nothing received on this order is left to refund", { code: "NOTHING_TO_REFUND" });
      }
      const check = checkRefund(position, amount);
      if (!check.ok) {
        throw AppError.badRequest(
          check.code === "EXCEEDS_REFUNDABLE" ? `Refund amount cannot exceed ${noteMoney(check.refundable)} (received minus refunds already recorded)` : "Amount must be positive",
          { code: "REFUND_EXCEEDS_REFUNDABLE", refundable: toMajor(check.refundable) },
        );
      }
      const payment = await tx.payment.findFirst({ where: { orderId, status: "SUCCEEDED" }, orderBy: { settledAt: "desc" }, select: { id: true, paymentSessionId: true } });
      const refund = await tx.refund.create({
        data: {
          orderId,
          paymentId: payment?.id ?? null,
          amount: toMajor(amount),
          reason: input.reason ?? null,
          method: input.method ?? null,
          status: "COMPLETED",
          requestedByAdminId: adminId,
          completedByAdminId: adminId,
          completedAt: new Date(),
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      await timelineNote(tx, orderId, order.status, `Refund recorded: ${noteMoney(amount)}${input.method ? ` via ${input.method}` : ""}${input.reason ? ` — ${input.reason}` : ""}`, adminId);
      const after = await refreshPaymentStatus(tx, orderId, currency);
      await reversePointsForRefund(tx, orderId, Number(refund.amount), currency);
      return { refund, paymentSessionId: payment?.paymentSessionId ?? null, position: after };
    });
  } catch (err) {
    if (idempotencyKey && isUniqueViolation(err)) {
      const winner = await prisma.refund.findUnique({ where: { idempotencyKey } });
      if (winner) return replayed(winner.orderId, orderId, winner, "refund");
    }
    throw err;
  }
  return { refund: result.refund, paymentSessionId: result.paymentSessionId, summary: await getOrderPaymentSummary(orderId) };
}

/** D6: money owed back on an exchange downgrade, inside the exchange approval's transaction. It reserves `refundable`
 * (a later refund can't take the same money) until an admin completes it. */
export async function requestRefund(tx: Db, orderId: string, input: { amount: number; reason: string }, adminId: string | null) {
  const currency = await storeCurrency();
  const order = await lockOrder(tx, orderId);
  const amount = fromMajor(String(input.amount), currency);
  const check = checkRefund(await loadPosition(tx, order, currency), amount);
  if (!check.ok) {
    throw new AppError(409, `A refund of ${noteMoney(amount)} can't be requested — only ${noteMoney(check.refundable)} received on order ${order.orderNumber} is left to refund`, {
      code: "REFUND_EXCEEDS_REFUNDABLE",
      refundable: toMajor(check.refundable),
    });
  }
  const refund = await tx.refund.create({
    data: { orderId, amount: toMajor(amount), reason: input.reason, status: "REQUESTED", requestedByAdminId: adminId },
  });
  await timelineNote(tx, orderId, order.status, `Refund requested: ${noteMoney(amount)} — ${input.reason}`, adminId);
  await refreshPaymentStatus(tx, orderId, currency);
  return refund;
}

/** REQUESTED → COMPLETED, once (PL-9). Re-checks Σ completed refunds ≤ Σ paid. D8 reversal after commit. */
export async function completeRefund(orderId: string, refundId: string, input: CompleteRefundInput, adminId: string) {
  const currency = await storeCurrency();
  const refund = await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    const existing = await tx.refund.findUnique({ where: { id: refundId } });
    if (!existing || existing.orderId !== orderId) throw AppError.notFound("Refund not found");
    if (existing.status !== "REQUESTED") throw new AppError(409, "This refund has already been completed", { code: "REFUND_NOT_REQUESTED" });
    const amount = fromMajor(existing.amount.toString(), currency);
    if (!canCompleteRefund(await loadPosition(tx, order, currency), amount)) {
      throw new AppError(409, "Completing this refund would send back more than was received for the order", { code: "REFUND_EXCEEDS_PAID" });
    }
    const claimed = await tx.refund.updateMany({
      where: { id: refundId, status: "REQUESTED" },
      data: { status: "COMPLETED", completedAt: new Date(), completedByAdminId: adminId, method: input.method ?? existing.method },
    });
    if (claimed.count === 0) throw new AppError(409, "This refund has already been completed", { code: "REFUND_NOT_REQUESTED" });
    await timelineNote(tx, orderId, order.status, `Refund paid out: ${noteMoney(amount)}${input.method ? ` via ${input.method}` : ""}${input.note ? ` — ${input.note}` : ""}`, adminId);
    await refreshPaymentStatus(tx, orderId, currency);
    await reversePointsForRefund(tx, orderId, Number(existing.amount), currency);
    return tx.refund.findUniqueOrThrow({ where: { id: refundId } });
  });
  return { refund, summary: await getOrderPaymentSummary(orderId) };
}

/** D8 (PI-9.4): a refund counts against merchandise first — reverses `refund ÷ rewardable` of the order's points
 * (capped at what it earned by reverseDeliveryPoints). Inside the refund's transaction (Phase 8): the reversal commits or
 * rolls back with the refund. */
async function reversePointsForRefund(tx: Db, orderId: string, refundAmount: number, currency: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { orderNumber: true, customerId: true, subtotal: true, discount: true, bundleDiscount: true, couponDiscount: true } });
  if (!order?.customerId) return;
  const base = loyaltyBase(order, currency);
  if (base <= 0) return;
  // Ratio of two minor-unit integers — no float money arithmetic.
  const fraction = fromMajor(String(refundAmount), currency).amount / fromMajor(String(base), currency).amount;
  await reverseDeliveryPoints(tx, order.customerId, orderId, fraction);
}

// ─── Store credit (docs/ORDER_ADJUSTMENTS.md §4–§7) ─────────────────────────────────────────────────────────────────

/** Pays the order's balance due — as much as the customer's store balance allows, at most `cap` — with ONE STORE_CREDIT
 * Payment and its matching ledger spend, in the caller's transaction. Only the order's own customer's balance is ever used.
 * Idempotent per `idempotencyKey` (a replay returns the spend already recorded). Returns null when nothing was paid. */
export async function payWithStoreCredit(
  tx: Db,
  input: { orderId: string; customerId: string; idempotencyKey: string; cap?: Money; adminId?: string | null; note?: string },
) {
  const currency = await storeCurrency();
  const order = await lockOrder(tx, input.orderId);
  if (order.customerId !== input.customerId) throw AppError.forbidden("Store balance can only pay for the account holder's own order");
  const replay = await tx.customerCreditEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) return { payment: replay.paymentId ? await tx.payment.findUnique({ where: { id: replay.paymentId } }) : null, amount: fromMajor(replay.amount.abs().toString(), currency) };
  const position = await loadPosition(tx, order, currency);
  const balance = await lockCustomerBalance(tx, input.customerId, currency);
  let amount = min(position.amountDue, balance);
  if (input.cap) amount = min(amount, input.cap);
  if (amount.amount <= 0) return null;
  const payment = await tx.payment.create({
    data: { orderId: order.id, provider: "STORE_CREDIT", status: "SUCCEEDED", amount: toMajor(amount), note: input.note ?? "Paid from store balance", recordedByAdminId: input.adminId ?? null },
  });
  await spendCredit(tx, {
    customerId: input.customerId,
    amount,
    reason: `Paid toward order ${order.orderNumber}`,
    orderId: order.id,
    sourceType: "PAYMENT",
    sourceId: payment.id,
    paymentId: payment.id,
    idempotencyKey: input.idempotencyKey,
    adminId: input.adminId,
  });
  await timelineNote(tx, order.id, order.status, `Paid ${noteMoney(amount)} from store balance`, input.adminId);
  await refreshPaymentStatus(tx, order.id, currency);
  return { payment, amount };
}

/** A gateway checkout reserved store balance for its order (initiatePendingPayment); the order now exists, so the
 * reservation becomes that order's STORE_CREDIT payment. If the reservation was already given back (the session expired
 * before this late success), the same amount is spent afresh as far as the balance allows — whatever it can't cover
 * stays due on the order (PARTIALLY_PAID) rather than being invented. */
export async function settleReservedStoreCredit(tx: Db, input: { orderId: string; paymentSessionId: string; customerId: string }) {
  const currency = await storeCurrency();
  const reserve = await sessionReservation(tx, input.paymentSessionId);
  if (!reserve) return null;
  const order = await lockOrder(tx, input.orderId);
  const amount = fromMajor(reserve.amount.abs().toString(), currency);
  // Under the customer lock: still reserved (not given back by an expiry sweep, not consumed by a concurrent settle)?
  if (!(await claimableReservation(tx, input.paymentSessionId))) {
    // Never fail a paid gateway settlement: spend afresh what the balance allows; any shortfall stays due on the order.
    return payWithStoreCredit(tx, { orderId: order.id, customerId: input.customerId, cap: amount, idempotencyKey: `credit:session:${input.paymentSessionId}:respend` });
  }
  const payment = await tx.payment.create({
    data: { orderId: order.id, provider: "STORE_CREDIT", status: "SUCCEEDED", amount: toMajor(amount), note: "Paid from store balance (reserved at checkout)" },
  });
  await consumeSessionReservation(tx, input.paymentSessionId, { orderId: order.id, paymentId: payment.id });
  await timelineNote(tx, order.id, order.status, `Paid ${noteMoney(amount)} from store balance`);
  await refreshPaymentStatus(tx, order.id, currency);
  return { payment, amount };
}

/** Moves money owed back on an order to the customer's store balance instead of refunding it. At most the order's refund
 * due (CR-2) — so credited money is no longer refundable (CR-3) and nothing is compensated twice. Idempotent per key: a
 * repeat returns the entry already written, before any cap is re-checked. The caller holds no lock; this takes the order
 * row lock, then the customer row lock. Loyalty points follow D8 like a refund. */
export async function issueStoreCreditFromOrder(
  tx: Db,
  input: {
    orderId: string;
    type: CreditIssueType;
    /** Omitted = the whole refund due. */
    amount?: Money;
    /** REFUND_DUE (default): at most what is owed back. REFUNDABLE: at most what was received and not yet given back —
     * the D6 exchange downgrade's cap, the same one its refund request has always used. */
    cap?: "REFUND_DUE" | "REFUNDABLE";
    reason: string;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    adminId?: string | null;
  },
) {
  const currency = await storeCurrency();
  const order = await lockOrder(tx, input.orderId);
  const replay = await tx.customerCreditEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) return replay;
  if (!order.customerId) {
    throw AppError.badRequest("This order isn't linked to a customer account, so it can't be credited — record a refund instead", { code: "NO_CUSTOMER_FOR_CREDIT" });
  }
  const position = await loadPosition(tx, order, currency);
  const capped = input.cap === "REFUNDABLE" ? { ...position, refundDue: position.refundable } : position;
  const amount = input.amount ?? capped.refundDue;
  const check = checkCreditIssue(capped, amount);
  if (!check.ok) {
    throw AppError.badRequest(
      check.code === "EXCEEDS_REFUND_DUE" ? `Only ${noteMoney(check.refundDue)} is owed back on this order` : "Nothing is owed back on this order",
      { code: "CREDIT_EXCEEDS_REFUND_DUE", refundDue: toMajor(check.refundDue) },
    );
  }
  const entry = await issueCredit(tx, {
    customerId: order.customerId,
    type: input.type,
    amount,
    reason: input.reason,
    orderId: order.id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    idempotencyKey: input.idempotencyKey,
    adminId: input.adminId,
  });
  await timelineNote(tx, order.id, order.status, `Store credit: ${noteMoney(amount)} added to the customer's balance — ${input.reason}`, input.adminId);
  await refreshPaymentStatus(tx, order.id, currency);
  await reversePointsForRefund(tx, order.id, toMajor(amount), currency);
  return entry;
}

/** Staff move an order's refund due to the customer's store balance (POST /orders/:id/store-credit). */
export async function creditRefundDueToStore(orderId: string, input: { amount?: number; reason: string }, adminId: string, idempotencyKey?: string | null) {
  const currency = await storeCurrency();
  const key = idempotencyKey ? `credit:admin:${idempotencyKey}` : null;
  const entry = await prisma.$transaction(async (tx) => {
    const exists = key ? await tx.customerCreditEntry.findUnique({ where: { idempotencyKey: key } }) : null;
    if (exists && exists.orderId !== orderId) throw AppError.conflict("This Idempotency-Key was already used for a different order");
    const locked = await lockOrder(tx, orderId);
    if (locked.deletedAt) throw AppError.badRequest("Restore this order before crediting it");
    return issueStoreCreditFromOrder(tx, {
      orderId,
      type: "REFUND_TO_CREDIT",
      amount: input.amount !== undefined ? fromMajor(String(input.amount), currency) : undefined,
      reason: input.reason,
      sourceType: "ORDER",
      sourceId: orderId,
      // Without a header, one refund-to-credit per (order, amount owed) — a double click finds nothing left owed anyway.
      idempotencyKey: key ?? `credit:order:${orderId}:to-credit:${Date.now()}`,
      adminId,
    });
  });
  return { entry, summary: await getOrderPaymentSummary(orderId) };
}

// ─── Read model ──────────────────────────────────────────────────────────────────────────────────────────────────────

const PAYMENT_SELECT = {
  id: true,
  orderId: true,
  provider: true,
  status: true,
  amount: true,
  note: true,
  backfilled: true,
  settledAt: true,
  recordedByAdmin: { select: { name: true } },
} satisfies Prisma.PaymentSelect;

const REFUND_SELECT = {
  id: true,
  orderId: true,
  status: true,
  amount: true,
  reason: true,
  method: true,
  completedAt: true,
  createdAt: true,
  requestedByAdmin: { select: { name: true } },
  completedByAdmin: { select: { name: true } },
} satisfies Prisma.RefundSelect;

/** OrderPaymentSummary for many orders in three queries (admin bulk label fetch, order detail). */
export async function summarizeOrderPayments(orderIds: string[]): Promise<Map<string, OrderPaymentSummary>> {
  const out = new Map<string, OrderPaymentSummary>();
  if (!orderIds.length) return out;
  const currency = await storeCurrency();
  const [orders, payments, refunds, creditRows, returnedValues] = await Promise.all([
    prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, total: true, paymentMethod: true, status: true } }),
    prisma.payment.findMany({ where: { orderId: { in: orderIds } }, select: PAYMENT_SELECT, orderBy: { settledAt: "asc" } }),
    prisma.refund.findMany({ where: { orderId: { in: orderIds } }, select: REFUND_SELECT, orderBy: { createdAt: "asc" } }),
    creditEntriesForOrders(prisma, orderIds),
    returnedValueByOrder(prisma, orderIds),
  ]);
  for (const order of orders) {
    const ps = payments.filter((p) => p.orderId === order.id);
    const rs = refunds.filter((r) => r.orderId === order.id);
    const cs = creditRows.filter((c) => c.orderId === order.id);
    const credited = cs.reduce((acc, c) => acc.add(c.amount), new Prisma.Decimal(0));
    const pos = positionFromRows(order, { payments: ps, refunds: rs, credited, returned: returnedValues.get(order.id) }, currency);
    const fromCredit = ps.filter((p) => p.status === "SUCCEEDED" && p.provider === "STORE_CREDIT").reduce((acc, p) => acc.add(p.amount), new Prisma.Decimal(0));
    out.set(order.id, {
      status: pos.status,
      currency,
      total: Number(order.total),
      paid: toMajor(pos.paid),
      refunded: toMajor(pos.refunded),
      refundPending: toMajor(pos.refundPending),
      credited: toMajor(pos.credited),
      paidFromStoreCredit: Number(fromCredit),
      netPaid: toMajor(pos.netPaid),
      amountDue: toMajor(pos.amountDue),
      codToCollect: toMajor(pos.codToCollect),
      refundable: toMajor(pos.refundable),
      refundDue: toMajor(pos.refundDue),
      overpaid: toMajor(pos.overpaid),
      payments: ps.map((p) => ({
        id: p.id,
        provider: p.provider,
        status: p.status,
        amount: Number(p.amount),
        note: p.note,
        backfilled: p.backfilled,
        settledAt: p.settledAt.toISOString(),
        recordedBy: p.recordedByAdmin?.name ?? null,
      })),
      refunds: rs.map((r) => ({
        id: r.id,
        status: r.status,
        amount: Number(r.amount),
        reason: r.reason,
        method: r.method,
        requestedBy: r.requestedByAdmin?.name ?? null,
        completedBy: r.completedByAdmin?.name ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      credits: cs.map((c) => ({
        id: c.id,
        type: c.type,
        amount: Number(c.amount),
        reason: c.reason,
        createdAt: c.createdAt.toISOString(),
        createdBy: c.createdByAdmin?.name ?? null,
      })),
    });
  }
  return out;
}

export async function getOrderPaymentSummary(orderId: string): Promise<OrderPaymentSummary> {
  const summary = (await summarizeOrderPayments([orderId])).get(orderId);
  if (!summary) throw AppError.notFound("Order not found");
  return summary;
}

/** The courier's COD amount (Steadfast cod_amount) for each order — the position's `codToCollect` (PL-6). */
export async function codToCollectFor(orderIds: string[]): Promise<Map<string, number>> {
  const summaries = await summarizeOrderPayments(orderIds);
  return new Map([...summaries].map(([id, s]) => [id, s.codToCollect]));
}

export async function listRefunds(orderId: string) {
  return prisma.refund.findMany({
    where: { orderId },
    include: { requestedByAdmin: { select: { name: true } }, completedByAdmin: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

// ─── Reconciliation (§12) ────────────────────────────────────────────────────────────────────────────────────────────

export interface PaymentLedgerDriftRow {
  orderId: string;
  orderNumber: string;
  stored: string;
  derived: string;
}

export interface PaymentLedgerViolation {
  orderId: string;
  orderNumber: string;
  rule: "PL-2 refunded exceeds paid" | "PL-5 delivered COD order not paid";
  detail: string;
}

/** Read-only: every order whose stored paymentStatus differs from its ledger (PL-1), plus rule violations that need a
 * person (PL-2, PL-5). Scans in id-ordered batches. */
export async function paymentLedgerDrift(opts: { batchSize?: number } = {}) {
  const batchSize = opts.batchSize ?? 500;
  const currency = await storeCurrency();
  const drift: PaymentLedgerDriftRow[] = [];
  const violations: PaymentLedgerViolation[] = [];
  let checked = 0;
  let cursor: string | undefined;
  for (;;) {
    const orders = await prisma.order.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        paymentMethod: true,
        status: true,
        paymentStatus: true,
        payments: { select: { status: true, amount: true } },
        refunds: { select: { status: true, amount: true } },
      },
    });
    if (!orders.length) break;
    const [credits, returnedValues] = await Promise.all([creditedByOrder(prisma, orders.map((o) => o.id)), returnedValueByOrder(prisma, orders.map((o) => o.id))]);
    for (const o of orders) {
      checked++;
      const pos = positionFromRows(o, { ...o, credited: credits.get(o.id), returned: returnedValues.get(o.id) }, currency);
      if (o.paymentStatus !== pos.status) drift.push({ orderId: o.id, orderNumber: o.orderNumber, stored: o.paymentStatus, derived: pos.status });
      if (pos.refunded.amount + pos.credited.amount > pos.paid.amount) {
        violations.push({
          orderId: o.id,
          orderNumber: o.orderNumber,
          rule: "PL-2 refunded exceeds paid",
          detail: `paid ${noteMoney(pos.paid)}, refunded ${noteMoney(pos.refunded)}, credited ${noteMoney(pos.credited)}`,
        });
      }
      if (o.paymentMethod === "COD" && o.status === "DELIVERED" && !["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(pos.status)) {
        violations.push({ orderId: o.id, orderNumber: o.orderNumber, rule: "PL-5 delivered COD order not paid", detail: `derived ${pos.status}` });
      }
    }
    cursor = orders[orders.length - 1]!.id;
  }
  return { checked, drift, violations };
}

/** Rewrites only the projection, through refreshPaymentStatus, for every drifted order. Dry run unless `apply`.
 * Violations are never auto-repaired. */
export async function repairPaymentLedger(opts: { apply?: boolean } = {}) {
  const report = await paymentLedgerDrift();
  if (!opts.apply) return { checked: report.checked, applied: false, changed: report.drift, violations: report.violations };
  const currency = await storeCurrency();
  const changed: PaymentLedgerDriftRow[] = [];
  for (const row of report.drift) {
    const position = await prisma.$transaction(async (tx) => {
      await lockOrder(tx, row.orderId);
      return refreshPaymentStatus(tx, row.orderId, currency);
    });
    changed.push({ ...row, derived: position.status });
  }
  return { checked: report.checked, applied: true, changed, violations: report.violations };
}

// ─── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

async function replayed<T>(rowOrderId: string | null, orderId: string, row: T, kind: "payment" | "refund" = "payment") {
  if (rowOrderId !== orderId) throw AppError.conflict("This Idempotency-Key was already used for a different order");
  const summary = await getOrderPaymentSummary(orderId);
  return kind === "refund" ? { refund: row, paymentSessionId: null, summary } : { payment: row, summary };
}
