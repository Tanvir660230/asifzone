import type {
  ExchangePreview,
  ItemReturnPreview,
  ItemReturnPreviewInput,
  OrderModificationInput,
  OrderModificationPreview,
  OrderModificationRecord,
  OrderPaymentSummary,
  RecordItemReturnInput,
  ReturnRequest,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

/** Staff order adjustments (docs/ORDER_ADJUSTMENTS.md §12). Every amount in these responses is computed by the server. */

export function previewOrderModification(orderId: string, input: OrderModificationInput) {
  return apiFetch<{ preview: OrderModificationPreview }>(`/api/orders/${orderId}/modifications/preview`, { method: "POST", body: input });
}

export function applyOrderModification(orderId: string, input: OrderModificationInput, idempotencyKey: string) {
  return apiFetch<{ modification: Pick<OrderModificationRecord, "id" | "sequence" | "status" | "amountDue" | "amountCredited">; preview: OrderModificationPreview; payment: OrderPaymentSummary }>(
    `/api/orders/${orderId}/modifications`,
    { method: "POST", body: input, idempotencyKey },
  );
}

export function listOrderModifications(orderId: string) {
  return apiFetch<{ modifications: OrderModificationRecord[] }>(`/api/orders/${orderId}/modifications`);
}

export function previewItemReturn(orderId: string, input: ItemReturnPreviewInput) {
  return apiFetch<{ preview: ItemReturnPreview }>(`/api/orders/${orderId}/returns/preview`, { method: "POST", body: input });
}

export function recordItemReturn(orderId: string, input: RecordItemReturnInput, idempotencyKey: string) {
  return apiFetch<{ returnRequest: ReturnRequest; payment: OrderPaymentSummary }>(`/api/orders/${orderId}/returns`, { method: "POST", body: input, idempotencyKey });
}

export function getExchangePreview(requestId: string) {
  return apiFetch<{ preview: ExchangePreview }>(`/api/return-requests/${requestId}/exchange-preview`);
}
