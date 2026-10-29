import type { DeviceKind, PageKind, VitalRating, WebVitalMetric } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

/** GET /api/v1/ops/reliability (ops.read) — what is stuck, failed or inconsistent. Read-only. */
export interface ReliabilityReport {
  generatedAt: string;
  needsAttention: number;
  sections: {
    outbox: {
      undelivered: number;
      failed: number;
      /** Of `failed`, the ones from the last 7 days — older failures are history unless retried. */
      failedLast7Days?: number;
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

/** Order Operations Phase 0: is the Steadfast webhook proven healthy, and at what pace does the courier-status poll run
 * (GET /api/v1/ops/courier-health, ops.read). Counts and reasons only — never a token or a request body. */
export interface CourierHealthReport {
  generatedAt: string;
  webhook: {
    last48h: {
      state: "HEALTHY" | "NOT_PROVEN" | "DEGRADED";
      checks: Array<{ id: string; ok: boolean; detail: string }>;
      stats: { lastValidEventAt: string | null; rejections: number; openParcels: number; overdueParcels: number };
    };
    lastWeek: { state: "HEALTHY" | "NOT_PROVEN" | "DEGRADED" };
    lastRejection: { reason: string; at: string } | null;
  };
  polling: { level: number; maxLevel: number; openParcels: number; overdueParcels: number };
}

export function getCourierHealth() {
  return apiFetch<CourierHealthReport>("/api/v1/ops/courier-health");
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

/** Site health › Site speed: 75th-percentile Core Web Vitals per metric × page kind × device (GET /api/v1/ops/vitals, ops.read). */
export interface VitalRow {
  metric: WebVitalMetric;
  pageKind: PageKind;
  device: DeviceKind;
  p75: number;
  samples: number;
  rating: VitalRating;
}

export const vitalsKeys = { all: ["ops-vitals"] as const, window: (days: number) => ["ops-vitals", days] as const };

export function getVitals(days: number) {
  return apiFetch<{ days: number; rows: VitalRow[] }>(`/api/v1/ops/vitals?days=${days}`);
}
