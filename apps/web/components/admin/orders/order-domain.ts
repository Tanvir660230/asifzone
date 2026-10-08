import type { QueryClient } from "@tanstack/react-query";
import { attentionKeys } from "@/lib/query-keys";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import {
  allowedNextOrderStatuses,
  orderStatusEnum,
  type Order,
  type OrderStatus,
  type OrderTransitionContext,
  orderTransitionContext,
  orderAttentionItems,
  type OrderAttentionItem,
} from "@clothing-brand/shared";
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

/** Warm an order's detail before it's opened (Blueprint V2 §Z): row hover/focus, and the drawer's neighbours. Fresh
 * data within 30 s isn't fetched again. */
export function prefetchOrder(queryClient: QueryClient, orderId: string) {
  void queryClient.prefetchQuery({ queryKey: orderKeys.detail(orderId), queryFn: () => adminOrdersApi.getOrder(orderId), staleTime: 30_000 });
}

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
    cancel: can("orders.cancel"),
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

/** The moves this admin may offer from `status`: the state machine's, minus Cancelled without orders.cancel (DR-5). */
export function nextStatusesFor(status: OrderStatus, perms: { cancel: boolean }): OrderStatus[] {
  return allowedNextOrderStatuses(status).filter((s) => s !== "CANCELLED" || perms.cancel);
}

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
  return orderTransitionContext(order);
}

export type { OrderAttentionItem } from "@clothing-brand/shared";

/** What about this order needs attention, most urgent first — the shared definition (packages/shared order-attention),
 * written with the store's formatters. The AI assistant reads the same items. */
export function orderAttention(order: OrderFacts, now = new Date()): OrderAttentionItem[] {
  return orderAttentionItems(order, { price: formatPrice, dateTime: formatStoreDateTime }, now);
}

/** A line's amount as snapshotted at checkout (unit price snapshot × quantity) — the same figure the invoice prints. Order
 * totals are never re-added from lines on the client; they come from the order (subtotal, discount, shipping, total). */
export function orderLineAmount(item: { priceSnapshot: string; quantity: number }): number {
  return Number(item.priceSnapshot) * item.quantity;
}
