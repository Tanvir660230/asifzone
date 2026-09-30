import type { CompleteRefundInput, OrderPaymentSummary, RecordPaymentInput, Refund, RecordRefundInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface PaymentsOverview {
  attemptsToday: number;
  attemptsTodayByProvider: Array<{ provider: string; count: number }>;
  successRateTodayPct: number;
  activeSessionsCount: number;
  epsReconciliationQueueDepth: number;
  cancelledButPaidCount: number;
  recentFailures: Array<{ orderNumber: string | null; provider: string; failedAt: string }>;
  refundsThisMonthCount: number;
  refundsThisMonthAmount: number;
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

export function getPaymentsOverview() {
  return apiFetch<PaymentsOverview>("/api/payment-admin/overview");
}

export function searchPaymentAttempts(phone: string) {
  return apiFetch<{ results: PaymentAttemptSearchResult[] }>(
    `/api/payment-admin/search?phone=${encodeURIComponent(phone)}`,
  );
}

export function listRefunds(orderId: string) {
  return apiFetch<{ refunds: Refund[] }>(`/api/orders/${orderId}/refunds`);
}

export function createRefund(orderId: string, input: RecordRefundInput, idempotencyKey?: string) {
  return apiFetch<{ refund: Refund; summary: OrderPaymentSummary }>(`/api/orders/${orderId}/refunds`, { method: "POST", body: input, idempotencyKey });
}

/** Marks a REQUESTED refund (D6 exchange downgrade) as paid out. */
export function completeRefund(orderId: string, refundId: string, input: CompleteRefundInput) {
  return apiFetch<{ refund: Refund; summary: OrderPaymentSummary }>(`/api/orders/${orderId}/refunds/${refundId}/complete`, { method: "POST", body: input });
}

/** Records a payment received by hand (MANUAL) or the cash a courier collected on a partial delivery (COD_COLLECTED). */
export function recordPayment(orderId: string, input: RecordPaymentInput, idempotencyKey?: string) {
  return apiFetch<{ summary: OrderPaymentSummary }>(`/api/orders/${orderId}/payments`, { method: "POST", body: input, idempotencyKey });
}
