import type {
  CorrectParcelReceiptInput,
  ParcelReceiptView,
  ParcelResolveResult,
  ParcelScanBatchView,
  ParcelScanEventRow,
  ParcelScanKind,
  ParcelView,
  ReceiveParcelInput,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";
import { idempotencyKeyFor } from "../idempotency";

/** Dispatch and return scanning (Order Operations phase 4) — /api/parcel-scans. */

/** What a scanned code names — changes nothing. */
export function resolveCode(code: string, mode: ParcelScanKind) {
  return apiFetch<ParcelResolveResult>("/api/parcel-scans/resolve", { method: "POST", body: { code, mode } });
}

/** The scanner's parcel card. */
export function getParcel(orderId: string) {
  return apiFetch<ParcelView>(`/api/parcel-scans/parcels/${orderId}`);
}

/** One confirmed receipt. Retries of the same confirmation (same parcel version and entries) reuse one Idempotency-Key, so
 * a timeout or a double click is received once. */
export function receiveParcel(input: ReceiveParcelInput) {
  return apiFetch<{ receipt: ParcelReceiptView; parcel: ParcelView; replayed: boolean }>("/api/parcel-scans/receive", {
    method: "POST",
    body: input,
    idempotencyKey: idempotencyKeyFor(`parcel-receive:${input.orderId}`, input),
  });
}

export function correctReceipt(receiptId: string, input: CorrectParcelReceiptInput) {
  return apiFetch<{ receipt: ParcelReceiptView; parcel: ParcelView }>(`/api/parcel-scans/receipts/${receiptId}/correct`, {
    method: "POST",
    body: input,
    idempotencyKey: idempotencyKeyFor(`parcel-correct:${receiptId}`, input),
  });
}

/** Tie a code the scanner doesn't know to an order, so its next scan opens it. */
export function linkCode(code: string, orderId: string) {
  return apiFetch<{ code: string; orderId: string; orderNumber: string }>("/api/parcel-scans/aliases", { method: "POST", body: { code, orderId } });
}

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

/** "The rider took these": hand the selected orders over without a scanner (one dispatch batch on the server). */
export function handOverFromList(orderIds: string[], note?: string) {
  return apiFetch<{ handedOver: number; skipped: Array<{ orderNumber: string; message: string }>; batchId: string | null }>("/api/parcel-scans/handover", {
    method: "POST",
    body: { orderIds, note },
  });
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
