import type { OrderStatus } from "./schemas/order";

/** The order state machine (docs/ORDER_STATE_MACHINE.md). Pure data + lookups: the API enforces it inside
 * one transaction (order.service.ts applyOrderTransition) and the admin UI reads it to offer only legal moves. */

/** What happens to the order's stock. `release` puts back every unit not already put back (a cancellation);
 * `return` does the same and counts the units as returned by the customer. Both are idempotent per order line. */
export type OrderStockEffect = "none" | "release" | "return";

/** Customer SMS touchpoint fired after commit (only those an admin can toggle in SMS settings). */
export type OrderStatusSmsTouchpoint = "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED";

export interface OrderTransitionRule {
  /** Row id in the spec's matrix (T0..T8). */
  id: string;
  /** Audit event name recorded with the transition. */
  event: string;
  stock: OrderStockEffect;
  /** Cash on Delivery: the courier collected the money at the door → UNPAID becomes PAID. */
  codCollected: boolean;
  /** The transition is only allowed once a refund has been recorded (paymentStatus REFUNDED). */
  requiresRecordedRefund: boolean;
  /** Log a courier-loss ledger row when a consignment was already booked. */
  courierLoss: boolean;
  /** Admin alert to raise (after commit) when the order is PAID. */
  alertIfPaid: "order.cancelled_but_paid" | "order.returned_refund_due" | null;
  customerSms: OrderStatusSmsTouchpoint | null;
  /** Award loyalty points (idempotent per order). */
  awardPoints: boolean;
}

export const PRE_SHIPMENT_STATUSES: readonly OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"];
export const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = ["CANCELLED", "RETURNED", "REFUNDED"];

const NONE = {
  stock: "none",
  codCollected: false,
  requiresRecordedRefund: false,
  courierLoss: false,
  alertIfPaid: null,
  customerSms: null,
  awardPoints: false,
} as const satisfies Omit<OrderTransitionRule, "id" | "event">;

/** A transition to the order's current status: nothing happens except (optionally) a timeline note. */
export const ORDER_NOOP_TRANSITION: OrderTransitionRule = { ...NONE, id: "T0", event: "order.note_added" };

const isPreShipment = (s: OrderStatus) => PRE_SHIPMENT_STATUSES.includes(s);

function rule(from: OrderStatus, to: OrderStatus): OrderTransitionRule | null {
  const preOrShipped = isPreShipment(from) || from === "SHIPPED";

  if (isPreShipment(from) && isPreShipment(to)) {
    return { ...NONE, id: "T1", event: "order.status_changed", customerSms: to === "CONFIRMED" ? "CONFIRMED" : null };
  }
  if (isPreShipment(from) && to === "SHIPPED") return { ...NONE, id: "T2", event: "order.shipped", customerSms: "SHIPPED" };
  if (from === "SHIPPED" && to === "PACKED") return { ...NONE, id: "T3", event: "order.status_changed" };
  if (preOrShipped && to === "DELIVERED") {
    return { ...NONE, id: "T4", event: "order.delivered", codCollected: true, customerSms: "DELIVERED", awardPoints: true };
  }
  if (preOrShipped && to === "PARTIALLY_DELIVERED") return { ...NONE, id: "T5", event: "order.partially_delivered" };
  if (preOrShipped && to === "CANCELLED") {
    return { ...NONE, id: "T6", event: "order.cancelled", stock: "release", courierLoss: true, alertIfPaid: "order.cancelled_but_paid", customerSms: "CANCELLED" };
  }
  if ((from === "DELIVERED" || from === "PARTIALLY_DELIVERED") && to === "RETURNED") {
    return { ...NONE, id: "T7", event: "order.returned", stock: "return", alertIfPaid: "order.returned_refund_due" };
  }
  if ((from === "DELIVERED" || from === "PARTIALLY_DELIVERED" || from === "CANCELLED" || from === "RETURNED") && to === "REFUNDED") {
    return { ...NONE, id: "T8", event: "order.refunded", requiresRecordedRefund: true };
  }
  return null;
}

/** The rule for `from → to`: ORDER_NOOP_TRANSITION when they are equal, null when the move is not allowed. */
export function getOrderTransition(from: OrderStatus, to: OrderStatus): OrderTransitionRule | null {
  if (from === to) return ORDER_NOOP_TRANSITION;
  return rule(from, to);
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return getOrderTransition(from, to) !== null;
}

const ALL_STATUSES: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
];

/** Every status the order may move to next (excluding its current one), in pipeline order. */
export function allowedNextOrderStatuses(from: OrderStatus): OrderStatus[] {
  return ALL_STATUSES.filter((to) => to !== from && rule(from, to) !== null);
}

/** Human-readable reason for a refused transition — shown by the API and the admin UI. */
export function describeRefusedTransition(from: OrderStatus, to: OrderStatus): string {
  const label = (s: OrderStatus) => s.toLowerCase().replace(/_/g, " ");
  if (CLOSED_ORDER_STATUSES.includes(from)) {
    return `A ${label(from)} order can't be moved to ${label(to)}${from === "REFUNDED" ? "" : " (only to refunded, once a refund is recorded)"} — place a new order instead`;
  }
  return `An order can't move from ${label(from)} to ${label(to)}`;
}
