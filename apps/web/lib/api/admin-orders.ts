import type {
  Order,
  AdminOrderListItem,
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  PaginatedResult,
  UpdateOrderDetailsInput,
  AdminCreateOrderInput,
  AdjustOrderPriceInput,
  ReconcilePartialDeliveryInput,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";
import { env } from "../env";

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
  // "true" = only CANCELLED orders where paymentStatus is still PAID — the refund-risk queue.
  cancelledButPaid?: "true";
  dateFrom?: string;
  dateTo?: string;
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
  if (params.cancelledButPaid) query.set("cancelledButPaid", params.cancelledButPaid);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.sortBy) query.set("sortBy", params.sortBy);
  if (params.sortDir) query.set("sortDir", params.sortDir);
  return query;
}

export function listOrders(params: AdminOrderListParams = {}) {
  return apiFetch<PaginatedResult<AdminOrderListItem>>(`/api/orders?${buildOrderListQuery(params).toString()}`);
}

export function getOrderStats() {
  return apiFetch<OrderStats>("/api/orders/stats");
}

/** CSV export needs the browser's cookie jar for admin auth but isn't JSON, so it bypasses apiFetch —
 * a plain same-tab navigation lets the browser handle the file download via Content-Disposition. */
export function downloadOrdersCsvUrl(params: AdminOrderListParams = {}) {
  return `${env.apiUrl}/api/orders/export/csv?${buildOrderListQuery(params).toString()}`;
}

export function bulkGetOrders(ids: string[]) {
  return apiFetch<{ orders: Order[] }>("/api/orders/bulk/get", { method: "POST", body: { ids } });
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
export function createManualOrder(input: AdminCreateOrderInput) {
  return apiFetch<{ order: Order }>("/api/orders/admin", { method: "POST", body: input });
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

export function bulkUpdateOrderStatus(ids: string[], status: OrderStatus) {
  return apiFetch<void>("/api/orders/bulk/status", { method: "POST", body: { ids, status } });
}

export function bulkDeleteOrders(ids: string[]) {
  return apiFetch<void>("/api/orders/bulk/delete", { method: "POST", body: { ids } });
}

export function bulkPermanentlyDeleteOrders(ids: string[]) {
  return apiFetch<void>("/api/orders/bulk/permanent", { method: "POST", body: { ids } });
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
  checked: Array<{ orderId: string; orderNumber: string; successRate: number | null; totalParcels: number }>;
  failed: Array<{ orderId: string; orderNumber: string; reason: string }>;
}

export function bulkCheckDeliveryScore(ids: string[]) {
  return apiFetch<BulkDeliveryScoreResult>("/api/orders/bulk/delivery-score", { method: "POST", body: { ids } });
}

export function getSteadfastBalance() {
  return apiFetch<{ balance: number }>("/api/courier/steadfast/balance");
}
