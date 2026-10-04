/**
 * The payment position of an order (docs/PAYMENT_LEDGER.md §3–§4) — the ONE derivation of what was paid, what was
 * refunded, what is still owed by the customer, what the courier collects, what may still be refunded and the order's
 * payment status. Its only inputs are the order's own ledger rows (Payment settlements and failures, Refund rows) and the
 * order total, so nothing current (settings, prices, providers) can change a historical answer. Pure: no Prisma, no
 * clock, integer minor units.
 */
import { add, clampNonNegative, subtract, sum, zero, type Money } from "./money";

export type LedgerPaymentStatus = "UNPAID" | "PAID" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED";

/** Order statuses whose goods never reached, or came back from, the customer — everything received is owed back. */
const REFUND_ALL_STATUSES = new Set(["CANCELLED", "RETURNED"]);
/** Closed orders: nothing is collected at the door any more. */
const CLOSED_STATUSES = new Set(["CANCELLED", "RETURNED", "REFUNDED"]);

export interface PaymentLedgerInput {
  currency: string;
  /** `Order.total` — what the order charges. */
  total: Money;
  paymentMethod: string;
  orderStatus: string;
  /** Amounts of SUCCEEDED Payment rows. A zero amount still counts as a settlement (a free exchange, a total-0 COD order). */
  settlements: Money[];
  /** Number of FAILED Payment rows (gateway attempts that definitively failed). */
  failedAttempts: number;
  /** Amounts of COMPLETED Refund rows (money sent back). */
  refundsCompleted: Money[];
  /** Amounts of REQUESTED Refund rows (owed, not yet paid out). */
  refundsRequested: Money[];
}

export interface PaymentPosition {
  status: LedgerPaymentStatus;
  settled: boolean;
  paid: Money;
  refunded: Money;
  refundPending: Money;
  /** paid − refunded, floored at 0. */
  netPaid: Money;
  /** What the customer still owes: total − paid, floored at 0 (a refund never creates a new debt). */
  amountDue: Money;
  /** Cash the courier collects on delivery: the balance due of an open COD order, else 0. */
  codToCollect: Money;
  /** The most a new refund may be: paid − refunded − requested, floored at 0. */
  refundable: Money;
  /** Money owed back: everything received for a cancelled/returned order, else the overpayment — net of requests. */
  refundDue: Money;
  /** netPaid − total, floored at 0 (e.g. a duplicate gateway payment). */
  overpaid: Money;
}

export function derivePaymentPosition(input: PaymentLedgerInput): PaymentPosition {
  const cur = input.currency;
  const paid = sum(input.settlements, cur);
  const refunded = sum(input.refundsCompleted, cur);
  const refundPending = sum(input.refundsRequested, cur);
  const settled = input.settlements.length > 0;
  const netPaid = clampNonNegative(subtract(paid, refunded));
  const amountDue = clampNonNegative(subtract(input.total, paid));
  const overpaid = clampNonNegative(subtract(netPaid, input.total));
  const codToCollect = input.paymentMethod === "COD" && !CLOSED_STATUSES.has(input.orderStatus) ? amountDue : zero(cur);
  const refundable = clampNonNegative(subtract(subtract(paid, refunded), refundPending));
  const refundDue = clampNonNegative(subtract(REFUND_ALL_STATUSES.has(input.orderStatus) ? netPaid : overpaid, refundPending));

  // §4 — evaluated in order.
  let status: LedgerPaymentStatus;
  if (refunded.amount > 0 && refunded.amount >= paid.amount) status = "REFUNDED";
  else if (settled && netPaid.amount >= input.total.amount) status = "PAID";
  else if (refunded.amount > 0) status = "PARTIALLY_REFUNDED";
  else if (!settled && input.failedAttempts > 0) status = "FAILED";
  else status = "UNPAID";

  return { status, settled, paid, refunded, refundPending, netPaid, amountDue, codToCollect, refundable, refundDue, overpaid };
}

export type RefundCheck = { ok: true } | { ok: false; code: "NOT_POSITIVE" | "EXCEEDS_REFUNDABLE"; refundable: Money };

/** A new refund (or refund request) must be positive and at most `refundable` (PL-2). */
export function checkRefund(position: PaymentPosition, amount: Money): RefundCheck {
  if (amount.amount <= 0) return { ok: false, code: "NOT_POSITIVE", refundable: position.refundable };
  if (amount.amount > position.refundable.amount) return { ok: false, code: "EXCEEDS_REFUNDABLE", refundable: position.refundable };
  return { ok: true };
}

export type ManualPaymentCheck = { ok: true } | { ok: false; code: "NOT_POSITIVE" | "EXCEEDS_AMOUNT_DUE"; amountDue: Money };

/** A manually recorded payment must be positive and at most the balance due — staff can't record an overpayment. */
export function checkManualPayment(position: PaymentPosition, amount: Money): ManualPaymentCheck {
  if (amount.amount <= 0) return { ok: false, code: "NOT_POSITIVE", amountDue: position.amountDue };
  if (amount.amount > position.amountDue.amount) return { ok: false, code: "EXCEEDS_AMOUNT_DUE", amountDue: position.amountDue };
  return { ok: true };
}

/** Completing a requested refund must keep Σ completed refunds ≤ Σ paid (PL-2). */
export function canCompleteRefund(position: PaymentPosition, amount: Money): boolean {
  return add(position.refunded, amount).amount <= position.paid.amount;
}

/** Statuses meaning "money was received and is at least partly still held" — the refund queue for cancelled orders. */
export const MONEY_HELD_PAYMENT_STATUSES: readonly LedgerPaymentStatus[] = ["PAID", "PARTIALLY_REFUNDED"];
/** Statuses meaning "this order has at least one refund" — for reports that ask whether an order was refunded. */
export const REFUNDED_PAYMENT_STATUSES: readonly LedgerPaymentStatus[] = ["REFUNDED", "PARTIALLY_REFUNDED"];
