import type { ParcelScanBatchView, ParcelScanEventRow, ParcelScanKind } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

/** Dispatch and return scanning (Order Operations phase 4) — /api/parcel-scans. */

export function currentBatch(kind: ParcelScanKind) {
  return apiFetch<{ batch: ParcelScanBatchView | null }>(`/api/parcel-scans/batches/current?kind=${kind}`);
}

export function createBatch(kind: ParcelScanKind) {
  return apiFetch<ParcelScanBatchView>("/api/parcel-scans/batches", { method: "POST", body: { kind } });
}

export function getBatch(id: string) {
  return apiFetch<ParcelScanBatchView>(`/api/parcel-scans/batches/${id}`);
}

export function recordScan(batchId: string, code: string, clientScanId: string) {
  return apiFetch<ParcelScanEventRow>(`/api/parcel-scans/batches/${batchId}/scans`, { method: "POST", body: { code, clientScanId } });
}

export function voidScan(batchId: string, eventId: string) {
  return apiFetch<ParcelScanBatchView>(`/api/parcel-scans/batches/${batchId}/scans/${eventId}`, { method: "DELETE" });
}

export function confirmBatch(batchId: string) {
  return apiFetch<ParcelScanBatchView>(`/api/parcel-scans/batches/${batchId}/confirm`, { method: "POST" });
}

export function cancelBatch(batchId: string) {
  return apiFetch<ParcelScanBatchView>(`/api/parcel-scans/batches/${batchId}/cancel`, { method: "POST" });
}

export function dispatchSummary() {
  return apiFetch<{ bookedToday: number; handedOverToday: number }>("/api/parcel-scans/summary");
}

export interface CourierAutomationRun {
  day: string;
  outcome: "OK" | "PARTIAL" | "FAILED" | "RUNNING";
  stuckInTransit: number;
  returnOverdue: number;
  handoverPending: number;
  payoutsChecked: number;
  payoutProblems: number;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** The daily courier check (Order Operations phase 5). */
export function latestAutomation() {
  return apiFetch<{ run: CourierAutomationRun | null }>("/api/parcel-scans/automation");
}

export function runAutomation() {
  return apiFetch<{ run: CourierAutomationRun }>("/api/parcel-scans/automation/run", { method: "POST" });
}
