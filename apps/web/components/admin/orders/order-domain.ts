import type { QueryClient } from "@tanstack/react-query";
import { attentionKeys } from "@/lib/query-keys";
import { MONEY_HELD_PAYMENT_STATUSES, PRE_SHIPMENT_STATUSES, orderStatusEnum, type Order, type OrderStatus, type OrderTransitionContext } from "@clothing-brand/shared";
import { formatPrice, formatStoreDateTime } from "@/lib/format";
import { useCapabilities } from "@/hooks/use-capability";
import { useProviderCapabilities } from "@/hooks/use-provider-capabilities";

/**
 * Orders workspace — the non-visual pieces shared by the list, the drawer and the full detail page: query keys and
 * invalidation, permission flags, and read-only selectors over server data. Business rules are NOT here: transitions,
 * consequences and command preconditions come from @clothing-brand/shared (the same code the API enforces), and every
 * amount comes from the server (order totals, the payment ledger summary).
 */

/** The courier integration behind `/api/orders/:id/courier/*` (lib/steadfast.ts) — named in one place, so a second
 * provider changes this label (or makes it data) instead of a dozen strings across the workspace. */
export const COURIER_PROVIDER_LABEL = "Steadfast";

/** Every order status, in pipeline order — from the shared schema, never a local copy. */
export const ORDER_STATUSES = orderStatusEnum.options as readonly OrderStatus[];

export const orderKeys = {
  list: ["admin-orders"] as const,
  stats: ["admin-order-stats"] as const,
  detail: (id: string) => ["admin-order", id] as const,
  /** Order changes (docs/ORDER_ADJUSTMENTS.md §3), payment links (§11) and item returns (§8) of one order. */
  modifications: (id: string) => ["admin-order", id, "modifications"] as const,
  paymentLinks: (id: string) => ["admin-order", id, "payment-links"] as const,
};

/** After any order command: the list, the KPI/queue counts and (when given) that order's detail are stale — the detail key
 * prefixes the order's changes and payment links, so those refresh with it. */
export function invalidateOrderQueries(queryClient: QueryClient, orderId?: string) {
  queryClient.invalidateQueries({ queryKey: orderKeys.list });
  queryClient.invalidateQueries({ queryKey: orderKeys.stats });
  queryClient.invalidateQueries({ queryKey: attentionKeys.all });
  if (orderId) queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
}

/** What the current admin may do in the Orders workspace — named views over the capability registry
 * (lib/admin/capabilities.ts). UX only — the API checks every permission itself. */
export function useOrderPermissions() {
  const { can, ready } = useCapabilities();
  // Phase 12 D-4: courier actions (booking, sync, delivery-score checks) only when the courier provider is configured on
  // this deployment — the `courier.manage` capability requires it.
  const { courier: courierConfigured } = useProviderCapabilities();
  return {
    /** False until the admin profile has loaded — don't show "not allowed" states before then. */
    ready,
    manage: can("orders.manage"),
    adjustPrice: can("orders.adjustPrice"),
    exportCsv: can("orders.export"),
    trash: can("orders.trash"),
    recordPayment: can("payments.record"),
    refunds: can("refunds.manage"),
    courier: can("courier.manage"),
    courierConfigured,
    returns: can("returns.manage"),
  };
}
export type OrderPermissions = ReturnType<typeof useOrderPermissions>;

type OrderFacts = Pick<
  Order,
  | "status"
  | "paymentMethod"
  | "paymentStatus"
  | "courierConsignmentId"
  | "courierStatus"
  | "courierSyncError"
  | "followUpAt"
  | "couponId"
  | "deletedAt"
  | "partialDeliveryReconciledAt"
> &
  Partial<Pick<Order, "payment" | "returnRequests">>;

export function transitionContextOf(order: OrderFacts): OrderTransitionContext {
  return {
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    courierBooked: Boolean(order.courierConsignmentId),
    hasCoupon: Boolean(order.couponId),
    hasFollowUp: Boolean(order.followUpAt),
  };
}

export interface OrderAttentionItem {
  key: string;
  tone: "danger" | "warning" | "info";
  label: string;
  detail?: string;
}

const moneyHeld = (paymentStatus: string) => (MONEY_HELD_PAYMENT_STATUSES as readonly string[]).includes(paymentStatus);

/**
 * What about this order needs someone's attention, most urgent first — each item restates a server fact (status,
 * payment status, ledger summary, courier sync state, return requests); nothing is computed beyond comparing them. Works
 * on a list row (no ledger summary) and on the full detail (ledger summary + return requests).
 */
export function orderAttention(order: OrderFacts, now = new Date()): OrderAttentionItem[] {
  const items: OrderAttentionItem[] = [];
  const refundDue = order.payment?.refundDue ?? 0;

  if (order.status === "CANCELLED" && moneyHeld(order.paymentStatus)) {
    items.push({
      key: "cancelled-paid",
      tone: "danger",
      label: "Cancelled but paid",
      detail: refundDue > 0 ? `${formatPrice(refundDue)} is owed back to the customer.` : "A refund may be owed.",
    });
  } else if (order.status === "RETURNED" && moneyHeld(order.paymentStatus)) {
    items.push({
      key: "returned-refund",
      tone: "danger",
      label: "Returned — refund due",
      detail: refundDue > 0 ? `${formatPrice(refundDue)} is owed back to the customer.` : "A refund may be owed.",
    });
  } else if (refundDue > 0) {
    items.push({ key: "refund-due", tone: "warning", label: "Refund owed", detail: `${formatPrice(refundDue)} is owed back to the customer.` });
  }
  if ((order.payment?.refundPending ?? 0) > 0) {
    items.push({ key: "refund-pending", tone: "warning", label: "Refund not paid out yet", detail: `${formatPrice(order.payment!.refundPending)} recorded as owed.` });
  }
  // Same scope as the server's "Courier issues" queue: only a parcel still on its way.
  const inFlight = PRE_SHIPMENT_STATUSES.includes(order.status) || order.status === "SHIPPED";
  if (inFlight && order.courierConsignmentId && order.courierSyncError) {
    items.push({ key: "courier-sync", tone: "danger", label: "Courier sync failing", detail: order.courierSyncError });
  }
  if (inFlight && order.courierConsignmentId && order.courierStatus === "hold") {
    items.push({ key: "courier-hold", tone: "warning", label: "Courier put the parcel on hold", detail: "Often an address or phone issue — check with the courier." });
  }
  if (order.status === "PARTIALLY_DELIVERED" && !order.partialDeliveryReconciledAt) {
    items.push({ key: "partial", tone: "warning", label: "Partial delivery to reconcile", detail: "Declare which units came back so stock is restored." });
  }
  if (order.paymentStatus === "FAILED") items.push({ key: "payment-failed", tone: "warning", label: "Payment failed" });
  if (order.status === "PENDING" && order.followUpAt) {
    const due = new Date(order.followUpAt) <= now;
    items.push({
      key: "follow-up",
      tone: due ? "warning" : "info",
      label: due ? "Follow-up call due" : "Follow-up scheduled",
      detail: formatStoreDateTime(order.followUpAt),
    });
  }
  const pendingRequests = order.returnRequests?.filter((r) => r.status === "PENDING") ?? [];
  if (pendingRequests.length > 0) {
    items.push({
      key: "return-request",
      tone: "warning",
      label: pendingRequests.some((r) => r.type === "EXCHANGE") ? "Exchange request awaiting review" : "Return request awaiting review",
    });
  }
  return items;
}

/** A line's amount as snapshotted at checkout (unit price snapshot × quantity) — the same figure the invoice prints. Order
 * totals are never re-added from lines on the client; they come from the order (subtotal, discount, shipping, total). */
export function orderLineAmount(item: { priceSnapshot: string; quantity: number }): number {
  return Number(item.priceSnapshot) * item.quantity;
}
