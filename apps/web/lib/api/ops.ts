import { apiFetch } from "../api-client";

/** GET /api/v1/ops/reliability (ops.read) — what is stuck, failed or inconsistent. Read-only. */
export interface ReliabilityReport {
  generatedAt: string;
  needsAttention: number;
  sections: {
    outbox: {
      undelivered: number;
      failed: number;
      oldestUndelivered: { eventType: string; consumer: string; ageSeconds: number } | null;
      dispatcherHealthy: boolean;
      recentFailures: Array<{ id: string; eventType: string; consumer: string; attempts: number; lastError: string | null; updatedAt: string }>;
    };
    courierBookings: {
      count: number;
      outcomeUnknown: number;
      items: Array<{ orderId: string; orderNumber: string; startedAt: string; outcomeUnknown: boolean; safeToRetry: boolean; detail: string | null }>;
    };
    paymentLedgerDrift: { count: number; violations: number; items: Array<{ orderId: string; orderNumber: string; stored: string; derived: string }> };
    stockDrift: { count: number; items: Array<{ variantId: string; sku: string; productName: string; currentStock: number; ledgerSum: number }> };
    readModelDrift: { count: number; items: Array<{ productId: string; issue: string; stored: string | null; expected: string }> };
    loyaltyDrift: { count: number; items: Array<{ customerId: string; name: string; balance: number; ledgerSum: number }> };
    stuckCampaigns: { count: number; items: Array<{ id: string; name: string; updatedAt: string }> };
  };
}

export function getReliabilityReport() {
  return apiFetch<ReliabilityReport>("/api/v1/ops/reliability");
}

/** Site health: one kind of production failure, grouped (GET /api/v1/ops/errors, ops.read). */
export interface ErrorGroupRow {
  id: string;
  source: "api" | "web";
  title: string;
  lastPath: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface ErrorGroupDetail extends ErrorGroupRow {
  errorClass: string;
  sampleStack: string | null;
  lastCorrelationId: string | null;
}

export const errorKeys = {
  all: ["ops-errors"] as const,
  list: (status: "open" | "resolved") => ["ops-errors", status] as const,
  detail: (id: string) => ["ops-errors", "detail", id] as const,
};

export function listErrors(status: "open" | "resolved") {
  return apiFetch<{ items: ErrorGroupRow[] }>(`/api/v1/ops/errors?status=${status}`);
}

export function getError(id: string) {
  return apiFetch<ErrorGroupDetail>(`/api/v1/ops/errors/${encodeURIComponent(id)}`);
}

/** "Mark fixed" (ops.repair) — hidden until it happens again. */
export function resolveError(id: string) {
  return apiFetch<void>(`/api/v1/ops/errors/${encodeURIComponent(id)}/resolve`, { method: "POST" });
}

/** Re-queues a FAILED outbox event (ops.repair — consumers are idempotent). */
export function retryOutboxEvent(id: string) {
  return apiFetch<void>(`/api/v1/outbox/${id}/retry`, { method: "POST" });
}
