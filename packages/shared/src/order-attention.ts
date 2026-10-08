import { MONEY_HELD_PAYMENT_STATUSES } from "./engines/payment-ledger";
import { PRE_SHIPMENT_STATUSES, canTransitionOrder } from "./order-state";
import type { OrderStatus } from "./schemas/order";

/**
 * Blueprint V2 P0 — one definition, shared by the order screens (list row, detail, preview) and the AI assistant:
 *  - suggestedNextOrderStatus: the obvious next step on the happy path, offered only when the state machine allows it;
 *  - orderAttentionItems: what about an order needs someone's attention, most urgent first. Each item restates a server
 *    fact (status, payment status, ledger summary, courier sync state, return requests) — nothing is computed beyond
 *    comparing them. Works on a list row (no ledger summary) and on the full detail.
 */

// The happy path only suggests; whether a move is allowed at all is the state machine's call.
const HAPPY_PATH: readonly OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"];

export function suggestedNextOrderStatus(current: OrderStatus): OrderStatus | null {
  const i = HAPPY_PATH.indexOf(current);
  const next = i === -1 ? undefined : HAPPY_PATH[i + 1];
  return next && canTransitionOrder(current, next) ? next : null;
}

export interface OrderAttentionFacts {
  status: OrderStatus;
  paymentStatus: string;
  courierConsignmentId: string | null;
  courierStatus: string | null;
  courierSyncError: string | null;
  followUpAt: string | Date | null;
  partialDeliveryReconciledAt: string | Date | null;
  /** The ledger summary — present on the detail, absent on list rows. */
  payment?: { refundDue: number; refundPending: number } | null;
  returnRequests?: ReadonlyArray<{ status: string; type: string }> | null;
}

export interface OrderAttentionItem {
  key: string;
  tone: "danger" | "warning" | "info";
  label: string;
  detail?: string;
}

/** How amounts and times are written — the caller's (the web's store formatters, the assistant's). */
export interface AttentionFormat {
  price: (amount: number) => string;
  dateTime: (at: string | Date) => string;
}

const moneyHeld = (paymentStatus: string) => (MONEY_HELD_PAYMENT_STATUSES as readonly string[]).includes(paymentStatus);

export function orderAttentionItems(order: OrderAttentionFacts, fmt: AttentionFormat, now = new Date()): OrderAttentionItem[] {
  const items: OrderAttentionItem[] = [];
  const refundDue = order.payment?.refundDue ?? 0;
  const owed = refundDue > 0 ? `${fmt.price(refundDue)} is owed back to the customer.` : "A refund may be owed.";

  if (order.status === "CANCELLED" && moneyHeld(order.paymentStatus)) {
    items.push({ key: "cancelled-paid", tone: "danger", label: "Cancelled but paid", detail: owed });
  } else if (order.status === "RETURNED" && moneyHeld(order.paymentStatus)) {
    items.push({ key: "returned-refund", tone: "danger", label: "Returned — refund due", detail: owed });
  } else if (refundDue > 0) {
    items.push({ key: "refund-due", tone: "warning", label: "Refund owed", detail: owed });
  }
  const refundPending = order.payment?.refundPending ?? 0;
  if (refundPending > 0) {
    items.push({ key: "refund-pending", tone: "warning", label: "Refund not paid out yet", detail: `${fmt.price(refundPending)} recorded as owed.` });
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
    items.push({ key: "follow-up", tone: due ? "warning" : "info", label: due ? "Follow-up call due" : "Follow-up scheduled", detail: fmt.dateTime(order.followUpAt) });
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
