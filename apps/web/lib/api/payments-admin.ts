import type { Refund, RecordRefundInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface PaymentsOverview {
  attemptsToday: number;
  attemptsTodayByProvider: Array<{ provider: string; count: number }>;
  successRateTodayPct: number;
  activeSessionsCount: number;
  epsReconciliationQueueDepth: number;
  cancelledButPaidCount: number;
  recentFailures: Array<{ orderNumber: string; provider: string; failedAt: string }>;
  refundsThisMonthCount: number;
  refundsThisMonthAmount: number;
}

export function getPaymentsOverview() {
  return apiFetch<PaymentsOverview>("/api/payment-admin/overview");
}

export function listRefunds(orderId: string) {
  return apiFetch<{ refunds: Refund[] }>(`/api/orders/${orderId}/refunds`);
}

export function createRefund(orderId: string, input: RecordRefundInput) {
  return apiFetch<{ refund: Refund }>(`/api/orders/${orderId}/refunds`, { method: "POST", body: input });
}
