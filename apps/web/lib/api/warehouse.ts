import type { LabelBatchInput, LabelBatchSummary, LabelBatchView, PickListResponse, PrintKind, PrintRunView, ProductLabelVariant } from "@clothing-brand/shared";
import { apiFetch, type FetchSignal } from "../api-client";

/** Picking, packing sheets, product labels and the print log (docs/WAREHOUSE_OPERATIONS.md §3). */

/** The orders list hands its selection to the pick-list page through sessionStorage, like Print labels does. */
export const PICK_LIST_ORDER_IDS_KEY = "pick-list-order-ids";
/** The pick list hands its variants (and quantities) to the product-label page. */
export const PRODUCT_LABEL_SELECTION_KEY = "product-label-selection";

export function getPickList(orderIds: string[]) {
  return apiFetch<PickListResponse>("/api/warehouse/pick-list", { method: "POST", body: { orderIds } });
}

export function listProductLabelVariants(params: { search?: string; variantIds?: string[]; limit?: number }, { signal }: FetchSignal = {}) {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.variantIds?.length) q.set("variantIds", params.variantIds.join(","));
  q.set("limit", String(params.limit ?? 60));
  return apiFetch<{ variants: ProductLabelVariant[] }>(`/api/warehouse/product-labels?${q.toString()}`, { signal });
}

export interface RecordPrintRunBody {
  kind: PrintKind;
  clientRunId: string;
  orderIds?: string[];
  variants?: Array<{ variantId: string; quantity: number }>;
  copies?: number;
  reason?: string;
}

export function recordPrintRun(body: RecordPrintRunBody) {
  return apiFetch<{ run: PrintRunView }>("/api/warehouse/print-runs", { method: "POST", body });
}

export function listPrintRuns(params: { kind?: PrintKind; orderId?: string; limit?: number } = {}, { signal }: FetchSignal = {}) {
  const q = new URLSearchParams();
  if (params.kind) q.set("kind", params.kind);
  if (params.orderId) q.set("orderId", params.orderId);
  q.set("limit", String(params.limit ?? 50));
  return apiFetch<{ runs: PrintRunView[] }>(`/api/warehouse/print-runs?${q.toString()}`, { signal });
}

/** One id per print attempt: a retried request is answered with the run already recorded (never a second one). */
export function newPrintRunId() {
  return `pr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Supplier lists for product stickers: what was ordered and what arrived; stickers print from them. */
export function listLabelBatches({ signal }: FetchSignal = {}) {
  return apiFetch<{ batches: LabelBatchSummary[] }>("/api/warehouse/label-batches", { signal });
}
export function getLabelBatch(id: string, { signal }: FetchSignal = {}) {
  return apiFetch<{ batch: LabelBatchView }>(`/api/warehouse/label-batches/${encodeURIComponent(id)}`, { signal });
}
export function createLabelBatch(body: LabelBatchInput) {
  return apiFetch<{ batch: LabelBatchView }>("/api/warehouse/label-batches", { method: "POST", body });
}
export function updateLabelBatch(id: string, body: LabelBatchInput) {
  return apiFetch<{ batch: LabelBatchView }>(`/api/warehouse/label-batches/${encodeURIComponent(id)}`, { method: "PUT", body });
}
export function deleteLabelBatch(id: string) {
  return apiFetch<void>(`/api/warehouse/label-batches/${encodeURIComponent(id)}`, { method: "DELETE" });
}
