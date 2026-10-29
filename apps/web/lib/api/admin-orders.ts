import type {
  Order,
  OrderPaymentSummary,
  AdminOrderListItem,
  OrderStatus,
  BulkOrderStatusResult,
  PaymentStatus,
  PaymentMethod,
  PaginatedResult,
  UpdateOrderDetailsInput,
  AdminCreateOrderInput,
  AdjustOrderPriceInput,
  ReconcilePartialDeliveryInput,
  ReceiveReturnedParcelInput,
  OrderQueueId,
} from "@clothing-brand/shared";
import { apiDownload, apiFetch, type FetchSignal } from "../api-client";

export type OrderOpsEvent = "confirmed" | "booked" | "delivered" | "partially_delivered" | "returned" | "cancelled";

export interface AdminOrderListParams {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  statusIn?: OrderStatus[];
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  search?: string;
  deleted?: boolean;
  courierBooked?: "true" | "false";
  courierStatus?: string;
  shippingDivision?: string;
  shippingDistrict?: string;
  // "true" = only PENDING orders whose confirmation-call follow-up is due now or overdue.
  followUpDue?: "true";
  // "true" = COD orders still PENDING after 48 h (owner decision Q6) — a person decides; nothing is released automatically.
  codPendingStale?: "true";
  // "true" = the "Needs action" queue (every order a person has to act on).
  needsAction?: "true";
  // "true" = only CANCELLED orders where paymentStatus is still PAID — the refund-risk queue.
  cancelledButPaid?: "true";
  // "true" = only RETURNED orders still holding money — the "returned, refund may be owed" queue.
  refundDue?: "true";
  // "true" = only booked orders on courier hold or with a failed status sync.
  courierIssue?: "true";
  dateFrom?: string;
  dateTo?: string;
  /** Daily-pulse drill-down: orders that reached this step on `opsDate` (both needed). */
  opsEvent?: OrderOpsEvent;
  opsDate?: string;
  sortBy?: "orderNumber" | "customerName" | "paymentStatus" | "total" | "status" | "createdAt";
  sortDir?: "asc" | "desc";
}

export interface OrderStats {
  todayOrders: number;
  todayRevenue: number;
  pending: number;
  needsAttention: number;
  followUpDue: number;
  cancelledButPaidCount: number;
  statusCounts: Record<OrderStatus, number>;
  /** One count per quick filter, computed by the same where-builder the list uses (ORDER_QUEUE_FILTERS). */
  queueCounts: Record<OrderQueueId, number>;
  /** Return/exchange requests waiting for a decision. */
  returnRequestsPending: number;
}

/** Per-order outcome of a bulk trash / restore / permanent delete — the server runs each order on its own. */
export interface BulkOrderOutcome {
  succeeded: string[];
  failed: Array<{ id: string; orderNumber: string | null; reason: string }>;
}

function buildOrderListQuery(params: AdminOrderListParams) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.status) query.set("status", params.status);
  if (params.statusIn?.length) query.set("statusIn", params.statusIn.join(","));
  if (params.paymentStatus) query.set("paymentStatus", params.paymentStatus);
  if (params.paymentMethod) query.set("paymentMethod", params.paymentMethod);
  if (params.search) query.set("search", params.search);
  if (params.deleted) query.set("deleted", "true");
  if (params.courierBooked) query.set("courierBooked", params.courierBooked);
  if (params.courierStatus) query.set("courierStatus", params.courierStatus);
  if (params.shippingDivision) query.set("shippingDivision", params.shippingDivision);
  if (params.shippingDistrict) query.set("shippingDistrict", params.shippingDistrict);
  if (params.followUpDue) query.set("followUpDue", params.followUpDue);
  if (params.codPendingStale) query.set("codPendingStale", params.codPendingStale);
  if (params.needsAction) query.set("needsAction", params.needsAction);
  if (params.cancelledButPaid) query.set("cancelledButPaid", params.cancelledButPaid);
  if (params.refundDue) query.set("refundDue", params.refundDue);
  if (params.courierIssue) query.set("courierIssue", params.courierIssue);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.opsEvent && params.opsDate) {
    query.set("opsEvent", params.opsEvent);
    query.set("opsDate", params.opsDate);
  }
  if (params.sortBy) query.set("sortBy", params.sortBy);
  if (params.sortDir) query.set("sortDir", params.sortDir);
  return query;
}

export function listOrders(params: AdminOrderListParams = {}, { signal }: FetchSignal = {}) {
  return apiFetch<PaginatedResult<AdminOrderListItem>>(`/api/orders?${buildOrderListQuery(params).toString()}`, { signal });
}

export function getOrderStats() {
  return apiFetch<OrderStats>("/api/orders/stats");
}

/** CSV export needs the browser's cookie jar for admin auth but isn't JSON, so it bypasses apiFetch —
 * a plain same-tab navigation lets the browser handle the file download via Content-Disposition. */
/** Saves the current filtered list as CSV; rejects with the server's message (bad filter, expired session) on failure. */
export function downloadOrdersCsv(params: AdminOrderListParams = {}) {
  return apiDownload(`/api/orders/export/csv?${buildOrderListQuery(params).toString()}`, "orders.csv");
}

export function bulkGetOrders(ids: string[]) {
  // Each order carries its payment ledger position — labels print `payment.codToCollect` as the COD amount.
  return apiFetch<{ orders: Array<Order & { payment: OrderPaymentSummary }> }>("/api/orders/bulk/get", { method: "POST", body: { ids } });
}

/** sessionStorage key the Orders list page writes selected ids to and the print-labels page reads
 * from — shared here so the two never drift apart on the key name. */
export const PRINT_LABEL_ORDER_IDS_KEY = "print-label-order-ids";

export function getOrder(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}`);
}

/** Admin "Create order" page — phone/Facebook orders a staff member types in themselves. Goes
 * through the same server-side createOrder pipeline as storefront checkout (stock decrement,
 * pricing, snapshotting), just via an admin-only endpoint that skips the online-gateway path. */
export function createManualOrder(input: AdminCreateOrderInput, idempotencyKey?: string) {
  return apiFetch<{ order: Order }>("/api/orders/admin", { method: "POST", body: input, idempotencyKey });
}

export function updateOrderStatus(id: string, status: OrderStatus, note?: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/status`, { method: "PATCH", body: { status, note } });
}

export function updateOrderDetails(id: string, input: UpdateOrderDetailsInput) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/details`, { method: "PATCH", body: input });
}

/** "Hold — call back later": records a confirmation-call attempt that was neither a clear yes nor
 * no, without changing the order's status. `followUpAt` is an ISO datetime string. */
export function holdOrder(id: string, followUpAt: string, note?: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/hold`, {
    method: "POST",
    body: { followUpAt, note: note || undefined },
  });
}

export function clearOrderHold(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/hold/clear`, { method: "POST" });
}

/** Manual total nudge (negotiated discount/surcharge) applied during the confirmation call —
 * replaces whatever adjustment was already on the order, it isn't additive. */
export function adjustOrderPrice(id: string, input: AdjustOrderPriceInput) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/price`, { method: "PATCH", body: input });
}

/** A parcel cancelled after it shipped has physically come back: restocks every unit still out (or the given lines).
 * Refused when nothing is left to receive. */
/** An order cancelled after it shipped whose units are still out with the courier (blueprint P1.5). */
export interface ParcelToReceive {
  orderId: string; orderNumber: string; customerName: string; customerPhone: string; trackingNumber: string | null; courierStatus: string | null;
  cancelledAt: string | null; units: number; value: number; daysOut: number | null; overdue: boolean;
}
export function listParcelsToReceive() {
  return apiFetch<{ followUpDays: number; parcels: ParcelToReceive[]; overdue: number }>("/api/orders/parcels-to-receive");
}

export function receiveReturnedParcel(id: string, input: ReceiveReturnedParcelInput) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/receive-return`, { method: "POST", body: input });
}

/** Attar lines still on the shelf: their bottles filled (READY), some of them (PARTLY_FILLED) or none yet (AWAITING_FILL) —
 * filled bottles go to waiting orders oldest first. Empty when the order has no attar waiting. */
export interface OrderFillLine { orderItemId: string; units: number; filled: number; toFill: number; status: "READY" | "PARTLY_FILLED" | "AWAITING_FILL" }
export function getOrderFillStatus(id: string, { signal }: FetchSignal = {}) {
  return apiFetch<{ lines: OrderFillLine[] }>(`/api/orders/${id}/fill-status`, { signal });
}

/** Resolves a PARTIALLY_DELIVERED order — declares how many units of each line item actually came
 * back so they can be restocked. See OrderDetailPanel's "Partial delivery" card. */
export function reconcilePartialDelivery(id: string, input: ReconcilePartialDeliveryInput) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/reconcile-partial-delivery`, { method: "PATCH", body: input });
}

export function deleteOrder(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}`, { method: "DELETE" });
}

export function restoreOrder(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/restore`, { method: "POST" });
}

export function permanentlyDeleteOrder(id: string) {
  return apiFetch<void>(`/api/orders/${id}/permanent`, { method: "DELETE" });
}

export function bulkUpdateOrderStatus(ids: string[], status: OrderStatus, note?: string) {
  return apiFetch<BulkOrderStatusResult>("/api/orders/bulk/status", { method: "POST", body: { ids, status, note: note || null } });
}

export function bulkDeleteOrders(ids: string[]) {
  return apiFetch<BulkOrderOutcome>("/api/orders/bulk/delete", { method: "POST", body: { ids } });
}

export function bulkRestoreOrders(ids: string[]) {
  return apiFetch<BulkOrderOutcome>("/api/orders/bulk/restore", { method: "POST", body: { ids } });
}

export function bulkPermanentlyDeleteOrders(ids: string[]) {
  return apiFetch<BulkOrderOutcome>("/api/orders/bulk/permanent", { method: "POST", body: { ids } });
}

export function bookCourier(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/courier/book`, { method: "POST" });
}

export function refreshCourierStatus(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/courier/refresh`, { method: "POST" });
}

export function unlinkCourier(id: string) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/courier/unlink`, { method: "POST" });
}

export interface BulkCourierBookResult {
  booked: Array<{ orderId: string; orderNumber: string; trackingNumber: string }>;
  failed: Array<{ orderId: string; orderNumber: string; reason: string }>;
}

export function bulkBookCourier(ids: string[]) {
  return apiFetch<BulkCourierBookResult>("/api/orders/bulk/courier/book", { method: "POST", body: { ids } });
}

export interface BulkCourierSyncResult {
  synced: Array<{ orderId: string; orderNumber: string; courierStatus: string }>;
  failed: Array<{ orderId: string; orderNumber: string; reason: string }>;
}

export function bulkSyncCourier(ids: string[]) {
  return apiFetch<BulkCourierSyncResult>("/api/orders/bulk/courier/sync", { method: "POST", body: { ids } });
}

export interface BulkDeliveryScoreResult {
  checked: Array<{ orderId: string; orderNumber: string; successRate: number | null; totalParcels: number; volumeRange: string | null }>;
  failed: Array<{ orderId: string; orderNumber: string; reason: string }>;
}

export function bulkCheckDeliveryScore(ids: string[]) {
  return apiFetch<BulkDeliveryScoreResult>("/api/orders/bulk/delivery-score", { method: "POST", body: { ids } });
}

export function getSteadfastBalance() {
  return apiFetch<{ balance: number }>("/api/courier/steadfast/balance");
}

/** The parcel note for the courier: the one built from the store's courier-note rules, staff's own wording if set, what
 * will be sent (`effective`), and — once booked — what was sent. */
export interface OrderCourierNote {
  built: string | null;
  override: string | null;
  effective: string | null;
  sent: string | null;
  booked: boolean;
}

export function getOrderCourierNote(id: string) {
  return apiFetch<OrderCourierNote>(`/api/orders/${id}/courier-note`);
}
