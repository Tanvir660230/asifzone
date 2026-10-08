import type { CompleteRefundInput, OrderPaymentSummary, PaymentLinkChannel, PaymentLinkDto, RecordPaymentInput, Refund, RecordRefundInput, PaginatedResult, PaymentTransactionRow, RefundRow, PaymentSessionRow } from "@clothing-brand/shared";
import { apiFetch, type FetchSignal } from "../api-client";

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

export interface LedgerListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  from?: string;
  to?: string;
}

function ledgerQuery(params: object) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return query.toString();
}

/** Finance › Transactions: every Payment ledger row, newest first. */
export function listPaymentTransactions(params: LedgerListParams & { provider?: string; status?: "SUCCEEDED" | "FAILED" } = {}, { signal }: FetchSignal = {}) {
  return apiFetch<PaginatedResult<PaymentTransactionRow>>(`/api/payment-admin/transactions?${ledgerQuery(params)}`, { signal });
}

/** Finance › Online attempts: gateway checkout sessions, newest first (incl. ones that never became an order). */
export function listPaymentSessions(params: LedgerListParams & { status?: PaymentSessionRow["status"]; provider?: PaymentSessionRow["provider"] } = {}, { signal }: FetchSignal = {}) {
  return apiFetch<PaginatedResult<PaymentSessionRow>>(`/api/payment-admin/sessions?${ledgerQuery(params)}`, { signal });
}

/** Finance › Refunds: every Refund ledger row, waiting ones first. */
export function listAllRefunds(params: LedgerListParams & { status?: "REQUESTED" | "COMPLETED" } = {}, { signal }: FetchSignal = {}) {
  return apiFetch<PaginatedResult<RefundRow>>(`/api/payment-admin/refunds?${ledgerQuery(params)}`, { signal });
}

export function getPaymentsOverview() {
  return apiFetch<PaymentsOverview>("/api/payment-admin/overview");
}

export function searchPaymentAttempts(phone: string, { signal }: FetchSignal = {}) {
  return apiFetch<{ results: PaymentAttemptSearchResult[] }>(`/api/payment-admin/search?phone=${encodeURIComponent(phone)}`, { signal });
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

// ─── Order adjustments (docs/ORDER_ADJUSTMENTS.md) ───────────────────────────────────────────────────────────────────

/** Moves money owed back on the order to the customer's store balance (default: all of it). */
export function creditToStoreBalance(orderId: string, input: { amount?: number; reason: string }, idempotencyKey: string) {
  return apiFetch<{ summary: OrderPaymentSummary }>(`/api/orders/${orderId}/store-credit`, { method: "POST", body: input, idempotencyKey });
}

export function listPaymentLinks(orderId: string) {
  return apiFetch<{ links: PaymentLinkDto[] }>(`/api/orders/${orderId}/payment-links`);
}

export function createPaymentLink(orderId: string, input: { expiresInHours: number; send: PaymentLinkChannel[]; modificationId?: string }) {
  return apiFetch<{ link: PaymentLinkDto }>(`/api/orders/${orderId}/payment-links`, { method: "POST", body: input });
}

export function cancelPaymentLink(orderId: string, linkId: string) {
  return apiFetch<{ link: PaymentLinkDto }>(`/api/orders/${orderId}/payment-links/${linkId}/cancel`, { method: "POST" });
}

export function sendPaymentLink(orderId: string, linkId: string, channels: PaymentLinkChannel[]) {
  return apiFetch<{ link: PaymentLinkDto }>(`/api/orders/${orderId}/payment-links/${linkId}/send`, { method: "POST", body: { channels } });
}
