/**
 * The payment position of an order (docs/PAYMENT_LEDGER.md §3–§4) — the ONE derivation of what was paid, what was
 * refunded, what is still owed by the customer, what the courier collects, what may still be refunded and the order's
 * payment status. Its only inputs are the order's own ledger rows (Payment settlements and failures, Refund rows, store
 * credit issued from the order's money) and the order total, so nothing current (settings, prices, providers) can change
 * a historical answer. Pure: no Prisma, no clock, integer minor units.
 *
 * Three separate kinds of money movement (docs/ORDER_ADJUSTMENTS.md §5):
 *   Payment  money received for the order (gateway, COD, manual, or STORE_CREDIT spent on it)
 *   Refund   money actually sent back
 *   Credit   money owed back that was moved to the customer's store balance (CustomerCreditEntry) instead of refunded
 * Credited money can no longer be refunded (`refundable` excludes it), so the same amount is never compensated twice.
 */
import { add, clampNonNegative, subtract, sum, zero, type Money } from "./money";

export type LedgerPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "CREDITED";

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
  /** Signed store-credit entries issued from this order's money (cancellation, modification, return, exchange,
   * refund-to-credit). Absent = none. Spending credit ON an order is a STORE_CREDIT settlement, not this. */
  credits?: Money[];
  /** Allocated value of merchandise that came back through item-level returns on a delivered order (ReturnRequest.lines)
   * — the order total itself is never rewritten; the position treats `total − returned` as what the order now charges. */
  returned?: Money[];
}

export interface PaymentPosition {
  status: LedgerPaymentStatus;
  settled: boolean;
  paid: Money;
  refunded: Money;
  refundPending: Money;
  /** Σ store credit issued from this order's money. */
  credited: Money;
  /** paid − refunded − credited, floored at 0: what the store still holds for this order. */
  netPaid: Money;
  /** What the customer still owes: total − (paid − credited) for an open order, total − paid for a closed one; floored at
   * 0. A refund never creates a new debt; on an open order, money moved to store credit no longer pays for it (a
   * modification that later raises the total collects it again). */
  amountDue: Money;
  /** Cash the courier collects on delivery: the balance due of an open COD order, else 0. */
  codToCollect: Money;
  /** The most a new refund (or credit) may be: paid − refunded − requested − credited, floored at 0. */
  refundable: Money;
  /** Money owed back: everything received for a cancelled/returned order, else the overpayment — net of requests. */
  refundDue: Money;
  /** netPaid − total (net of item-level returns), floored at 0 (a duplicate gateway payment, a lowered total, items
   * returned from a delivered order). */
  overpaid: Money;
}

export function derivePaymentPosition(input: PaymentLedgerInput): PaymentPosition {
  const cur = input.currency;
  const paid = sum(input.settlements, cur);
  const refunded = sum(input.refundsCompleted, cur);
  const refundPending = sum(input.refundsRequested, cur);
  const credited = clampNonNegative(sum(input.credits ?? [], cur));
  const settled = input.settlements.length > 0;
  // What the order charges once item-level returns are taken out (the stored total is history and stays as it is).
  const effectiveTotal = clampNonNegative(subtract(input.total, sum(input.returned ?? [], cur)));
  const netPaid = clampNonNegative(subtract(subtract(paid, refunded), credited));
  // Money moved to store credit no longer pays for an OPEN order (a change that raises the total again collects it). A
  // closed order (cancelled / returned / refunded) owes nothing more because of a credit: there, as before, only what was
  // paid counts.
  const amountDue = clampNonNegative(subtract(effectiveTotal, CLOSED_STATUSES.has(input.orderStatus) ? paid : subtract(paid, credited)));
  const overpaid = clampNonNegative(subtract(netPaid, effectiveTotal));
  const codToCollect = input.paymentMethod === "COD" && !CLOSED_STATUSES.has(input.orderStatus) ? amountDue : zero(cur);
  const refundable = clampNonNegative(subtract(subtract(subtract(paid, refunded), refundPending), credited));
  const refundDue = clampNonNegative(subtract(REFUND_ALL_STATUSES.has(input.orderStatus) ? netPaid : overpaid, refundPending));
  const compensated = add(refunded, credited);

  // §4 — evaluated in order.
  let status: LedgerPaymentStatus;
  if (refunded.amount > 0 && refunded.amount >= paid.amount) status = "REFUNDED";
  else if (credited.amount > 0 && compensated.amount >= paid.amount) status = "CREDITED";
  else if (settled && netPaid.amount >= effectiveTotal.amount) status = "PAID";
  else if (compensated.amount > 0) status = "PARTIALLY_REFUNDED";
  else if (settled && paid.amount > 0) status = "PARTIALLY_PAID";
  else if (!settled && input.failedAttempts > 0) status = "FAILED";
  else status = "UNPAID";

  return { status, settled, paid, refunded, refundPending, credited, netPaid, amountDue, codToCollect, refundable, refundDue, overpaid };
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

/** Completing a requested refund must keep Σ completed refunds + Σ credited ≤ Σ paid (PL-2, CR-3). */
export function canCompleteRefund(position: PaymentPosition, amount: Money): boolean {
  return add(add(position.refunded, position.credited), amount).amount <= position.paid.amount;
}

export type CreditIssueCheck = { ok: true } | { ok: false; code: "NOT_POSITIVE" | "EXCEEDS_REFUND_DUE"; refundDue: Money };

/** Store credit issued from an order's money must be positive and at most what is owed back (`refundDue`) — a credit
 * never exceeds what the customer is owed, and credited money can't then be refunded too (CR-3). */
export function checkCreditIssue(position: PaymentPosition, amount: Money): CreditIssueCheck {
  if (amount.amount <= 0) return { ok: false, code: "NOT_POSITIVE", refundDue: position.refundDue };
  if (amount.amount > position.refundDue.amount) return { ok: false, code: "EXCEEDS_REFUND_DUE", refundDue: position.refundDue };
  return { ok: true };
}

/** Statuses meaning "money was received and is at least partly still held" — the refund queue for cancelled orders. */
export const MONEY_HELD_PAYMENT_STATUSES: readonly LedgerPaymentStatus[] = ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"];
/** Statuses meaning "this order has at least one refund" — for reports that ask whether an order was refunded. */
export const REFUNDED_PAYMENT_STATUSES: readonly LedgerPaymentStatus[] = ["REFUNDED", "PARTIALLY_REFUNDED"];
