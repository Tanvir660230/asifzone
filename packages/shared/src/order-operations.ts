import type { OrderStatus } from "./schemas/order";
import type { OrderListQuery } from "./schemas/order";
import { CLOSED_ORDER_STATUSES, PRE_SHIPMENT_STATUSES } from "./order-state";

/**
 * Preconditions of the order commands that are not status transitions (docs/ORDER_STATE_MACHINE.md §4). The API checks
 * them (and throws); the admin UI reads the same predicates to decide what to offer, so the two can't drift. Each
 * `…Blocker` returns null when the command is allowed, or the reason it isn't. The server stays authoritative — it also
 * checks things the UI can't see (row locks, live stock, addresses).
 */

export interface OrderGuardFacts {
  status: OrderStatus;
  deletedAt: string | Date | null;
  courierConsignmentId: string | null;
  paymentMethod: string;
}

export const RESTORE_BEFORE_CHANGES = "Restore this order before making changes";

/** The sale is settled — the total can no longer be renegotiated. */
export const PRICE_ADJUSTMENT_LOCKED_STATUSES: readonly OrderStatus[] = ["CANCELLED", "REFUNDED", "RETURNED", "DELIVERED"];
/** Statuses a courier can no longer be booked for (closed, or already in the customer's hands). */
export const COURIER_UNBOOKABLE_STATUSES: readonly OrderStatus[] = ["CANCELLED", "REFUNDED", "RETURNED", "DELIVERED", "PARTIALLY_DELIVERED"];

export function priceAdjustmentBlocker(order: OrderGuardFacts, paidAmount: number): string | null {
  if (order.deletedAt) return RESTORE_BEFORE_CHANGES;
  if (PRICE_ADJUSTMENT_LOCKED_STATUSES.includes(order.status)) return `Cannot adjust price on an order that is ${order.status.toLowerCase()}`;
  if (order.courierConsignmentId) return "Cannot adjust price after a courier has been booked — unlink the booking first";
  if (paidAmount > 0) return "This order already has a payment recorded — record a refund instead of adjusting its total";
  return null;
}

/** Name / phone / address (tracking and admin notes stay editable). */
export function customerDetailsEditBlocker(order: OrderGuardFacts): string | null {
  if (order.deletedAt) return RESTORE_BEFORE_CHANGES;
  if (order.courierConsignmentId) return "Cannot change name/address after a courier has been booked — unlink the booking first";
  return null;
}

export function followUpHoldBlocker(order: OrderGuardFacts): string | null {
  if (order.deletedAt) return RESTORE_BEFORE_CHANGES;
  if (order.status !== "PENDING") return "Only pending orders can be put on a follow-up hold";
  return null;
}

/** The checks that need no I/O; the server also requires a usable address and claims the booking under a lock. */
export function courierBookingBlocker(order: OrderGuardFacts): string | null {
  if (order.deletedAt) return "Restore this order before booking a courier";
  if (order.courierConsignmentId) return "This order is already booked with a courier";
  if (COURIER_UNBOOKABLE_STATUSES.includes(order.status)) return `Cannot book a courier for an order that is ${order.status.toLowerCase()}`;
  return null;
}

export type ManualPaymentKind = "MANUAL" | "COD_COLLECTED";

/** COD_COLLECTED: cash the courier collected on a partial delivery. MANUAL: money received out of band before dispatch. */
export function manualPaymentKindFor(order: Pick<OrderGuardFacts, "status" | "paymentMethod">): ManualPaymentKind {
  return order.status === "PARTIALLY_DELIVERED" && order.paymentMethod === "COD" ? "COD_COLLECTED" : "MANUAL";
}

export function manualPaymentBlocker(order: OrderGuardFacts, kind: ManualPaymentKind): string | null {
  if (order.deletedAt) return "Restore this order before recording a payment";
  if (kind === "COD_COLLECTED") {
    if (order.paymentMethod !== "COD" || order.status !== "PARTIALLY_DELIVERED") {
      return "Courier-collected cash is recorded only for a partially delivered Cash on Delivery order";
    }
    return null;
  }
  if (CLOSED_ORDER_STATUSES.includes(order.status)) return `Can't record a payment on an order that is ${order.status.toLowerCase()}`;
  if (order.paymentMethod === "COD" && order.courierConsignmentId) {
    return "The courier already has this parcel's COD amount — unlink the booking before recording a prepayment";
  }
  return null;
}

// ─── Order adjustments (docs/ORDER_ADJUSTMENTS.md §3, §10) ──────────────────────────────────────────────────────────

export type OrderEditor = "CUSTOMER" | "ADMIN";

/** A customer may change their own order until the warehouse starts on it. CONFIRMED is still safe: confirmation is a
 * phone call or a payment, and nothing has been picked yet. PROCESSING/PACKED mean goods are being prepared. */
export const CUSTOMER_EDITABLE_STATUSES: readonly OrderStatus[] = ["PENDING", "CONFIRMED"];
/** Staff may change an order's contents until it leaves the building (every pre-shipment status). */
export const ADMIN_EDITABLE_STATUSES: readonly OrderStatus[] = PRE_SHIPMENT_STATUSES;
/** A customer may cancel their own order in the same window they may edit it. */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly OrderStatus[] = CUSTOMER_EDITABLE_STATUSES;

/** Whether the order's items / address may still be modified, and by whom. After shipment the only tools are returns,
 * exchanges, refunds and store credit — the original order is never rewritten to pretend it held something else. */
export function orderModificationBlocker(order: OrderGuardFacts, editor: OrderEditor): string | null {
  if (order.deletedAt) return RESTORE_BEFORE_CHANGES;
  if (CLOSED_ORDER_STATUSES.includes(order.status)) return `A ${order.status.toLowerCase()} order can't be changed`;
  if (order.status === "SHIPPED" || order.status === "DELIVERED" || order.status === "PARTIALLY_DELIVERED") {
    return editor === "ADMIN"
      ? "This order has left the warehouse — record a return or an exchange instead of editing it"
      : "This order has already been shipped and can't be changed";
  }
  const allowed = editor === "ADMIN" ? ADMIN_EDITABLE_STATUSES : CUSTOMER_EDITABLE_STATUSES;
  if (!allowed.includes(order.status)) return "This order is already being prepared and can no longer be changed — please contact us";
  if (order.courierConsignmentId) {
    return editor === "ADMIN"
      ? "A courier is booked for this order — unlink the booking before changing it"
      : "This order has already been handed to the courier and can't be changed";
  }
  return null;
}

export function customerCancelBlocker(order: OrderGuardFacts): string | null {
  if (order.deletedAt) return "Order not found";
  if (order.status === "CANCELLED") return null; // a repeat is answered with the order as it is (idempotent)
  if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) return "This order is already being prepared and can't be cancelled online — please contact us";
  if (order.courierConsignmentId) return "This order has already been handed to the courier and can't be cancelled online";
  return null;
}

/** Item-level returns are recorded once the goods reached the customer: DELIVERED, or a reconciled partial delivery. */
export function itemReturnBlocker(order: OrderGuardFacts & { partialDeliveryReconciledAt?: string | Date | null }): string | null {
  if (order.deletedAt) return RESTORE_BEFORE_CHANGES;
  if (order.status === "DELIVERED") return null;
  if (order.status === "PARTIALLY_DELIVERED") {
    return order.partialDeliveryReconciledAt ? null : "Reconcile the partial delivery first";
  }
  return "Returns are recorded only for delivered orders";
}

/** A payment link may be generated while something is still owed on an open order. */
export function paymentLinkBlocker(order: OrderGuardFacts, amountDue: number): string | null {
  if (order.deletedAt) return RESTORE_BEFORE_CHANGES;
  if (CLOSED_ORDER_STATUSES.includes(order.status)) return `Can't collect a payment on an order that is ${order.status.toLowerCase()}`;
  if (order.paymentMethod === "COD" && order.courierConsignmentId) {
    return "The courier already has this parcel's COD amount — unlink the booking before taking an online payment";
  }
  if (amountDue <= 0) return "Nothing is due on this order";
  return null;
}

/**
 * The admin orders list's quick filters ("queues"), as list-query presets. The list sends the preset as query params and
 * GET /api/orders/stats counts each preset through the same `where` builder, so a queue's badge always equals what the
 * filter shows.
 */
export const ORDER_QUEUE_IDS = ["needsAction", "followUpDue", "unpaid", "cod", "courierIssue", "cancelledButPaid", "refundDue", "cancelledReturned"] as const;
export type OrderQueueId = (typeof ORDER_QUEUE_IDS)[number];

export type OrderQueueFilter = Pick<
  OrderListQuery,
  "needsAction" | "followUpDue" | "paymentStatus" | "paymentMethod" | "courierIssue" | "cancelledButPaid" | "refundDue" | "statusIn"
>;

export const ORDER_QUEUE_FILTERS: Readonly<Record<OrderQueueId, OrderQueueFilter>> = {
  needsAction: { needsAction: "true" },
  followUpDue: { followUpDue: "true" },
  unpaid: { paymentStatus: "UNPAID" },
  cod: { paymentMethod: "COD" },
  courierIssue: { courierIssue: "true" },
  cancelledButPaid: { cancelledButPaid: "true" },
  refundDue: { refundDue: "true" },
  cancelledReturned: { statusIn: ["CANCELLED", "RETURNED"] },
};
