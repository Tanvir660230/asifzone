import type { Prisma } from "@prisma/client";
import type { OrderStatus } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

/**
 * Order history — the finished orders, kept out of the daily work list (the Orders page) and listed on their own page.
 * Nothing is moved or copied: "finished" is a predicate over the order's own facts, so an order leaves the work list the
 * moment its last piece of work is done, and comes back by itself if new work appears (a refund request, a review flag).
 *
 * Finished means the order is in a final status AND nothing is left to do on it:
 *   money      delivered: fully paid (or paid and since refunded / credited); cancelled or returned: no customer money held
 *   COD        a courier-tracked delivery has been settled — its parcel is in a Steadfast payout (Shipment.courierPayoutRef)
 *   review     no shipment leg waiting for a person (charge/contribution review, an excess to decide)
 *   parcel     every unit due back is back and closed (restocked or written off at inspection), nothing in hand uninspected
 *   partial    a partial delivery has been reconciled
 *   requests   no return/exchange request or refund waiting for a decision
 *
 * Every condition is written positively over non-null columns, IS [NOT] NULL tests and EXISTS subqueries, so the
 * predicate is always TRUE or FALSE (never SQL NULL) and its negation — the work list — is exactly the complement.
 */

export const ORDER_FINAL_STATUSES: OrderStatus[] = ["DELIVERED", "PARTIALLY_DELIVERED", "CANCELLED", "RETURNED", "REFUNDED"];

const items = prisma.orderItem.fields;

export function orderFinishedWhere(): Prisma.OrderWhereInput {
  return {
    AND: [
      { status: { in: ORDER_FINAL_STATUSES } },
      // Money: nothing still owed by the customer, nothing of theirs still held.
      {
        OR: [
          { status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] }, paymentStatus: { in: ["PAID", "CREDITED", "REFUNDED", "PARTIALLY_REFUNDED"] } },
          { status: { in: ["CANCELLED", "RETURNED", "REFUNDED"] }, paymentStatus: { in: ["UNPAID", "FAILED", "REFUNDED", "CREDITED"] } },
        ],
      },
      { OR: [{ status: { not: "PARTIALLY_DELIVERED" } }, { partialDeliveryReconciledAt: { not: null } }] },
      // COD settlement and reconciliation, on the order's own shipment legs (orders from before the legs existed have none).
      {
        shipments: {
          none: {
            OR: [
              { type: "OUTBOUND", trackedByCourier: true, operationalStatus: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] }, courierPayoutRef: null, order: { paymentMethod: "COD" } },
              { financialStatus: { in: ["NEEDS_REVIEW", "EXCESS_REVIEW"] } },
            ],
          },
        },
      },
      // The parcel: every unit that should come back has (receiving and inspecting a parcel is what closes its units —
      // restocked or written off as damaged / lost — so restockedQuantity catches up), and nothing is in hand uninspected.
      // A cancelled order that was never booked had nothing out.
      {
        OR: [
          { status: "CANCELLED", courierConsignmentId: null },
          { status: "CANCELLED", items: { none: { restockedQuantity: { lt: items.quantity } } } },
          { status: { not: "CANCELLED" }, items: { none: { restockedQuantity: { lt: items.returnedQuantity } } } },
        ],
      },
      { OR: [{ receivedBackAt: null }, { returnInspectedAt: { not: null } }] },
      { returnRequests: { none: { status: "PENDING" } } },
      { refunds: { none: { status: "REQUESTED" } } },
    ],
  };
}

/** The daily work list: every order that isn't finished. */
export function orderInProgressWhere(): Prisma.OrderWhereInput {
  return { NOT: orderFinishedWhere() };
}

/** Whether one order is finished (the detail page's "In Order history" line; the read-only guard on customer details). */
export async function isOrderFinished(orderId: string): Promise<boolean> {
  return (await prisma.order.count({ where: { id: orderId, ...orderFinishedWhere() } })) > 0;
}
