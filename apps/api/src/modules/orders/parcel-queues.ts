import type { Prisma } from "@prisma/client";
import type { OrderStatus, ParcelQueue } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

/**
 * The parcel-operations queues (Order Operations phase 4) as Order `where` clauses — one definition for the list, its
 * badges and the scanning pages.
 *
 *   Handover pending  booked in the last 7 days, still open, no handover scan yet ("booked − handed over" should be 0)
 *   Coming back       cancelled / returned units not yet restocked and the parcel hasn't physically arrived
 *   Inspection        physically back, not yet inspected (inspection is the only step that restocks)
 *   Discrepancy       physically back although nothing says it should be (the courier still reports it out / delivered)
 *   Stuck in transit  shipped and out longer than stuckInTransitDays (phase 5)
 *   Return overdue    coming back, reported longer ago than returnNotBackDays (phase 5)
 */

/** Statuses where the parcel is still meant to go out (or is out). */
const OUT_STATUSES: OrderStatus[] = ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"];
/** Statuses where a parcel is expected back. */
export const RETURN_EXPECTED_STATUSES: OrderStatus[] = ["CANCELLED", "RETURNED", "PARTIALLY_DELIVERED", "REFUNDED"];
/** Orders booked before this window aren't chased for a handover scan (they predate scanning, or are long gone). */
export const HANDOVER_WINDOW_DAYS = 7;

const booked = { courierConsignmentId: { not: null } } satisfies Prisma.OrderWhereInput;

/** Courier automation thresholds (StoreSetting; plan M8 defaults 6 and 14 days). */
export interface ParcelPolicy {
  stuckInTransitDays: number;
  returnNotBackDays: number;
}
export const DEFAULT_PARCEL_POLICY: ParcelPolicy = { stuckInTransitDays: 6, returnNotBackDays: 14 };

/** Each parcel queue's working order until a column is picked: the parcel waiting longest first — the oldest booking
 * not yet handed over, the longest out, the return reported longest ago, the parcel in hand longest. */
export function parcelQueueOrderBy(queue: ParcelQueue): Prisma.OrderOrderByWithRelationInput[] {
  switch (queue) {
    case "handoverPending":
      return [{ courierBookedAt: "asc" }, { id: "asc" }];
    case "stuckInTransit":
      return [{ handedOverAt: { sort: "asc", nulls: "first" } }, { courierBookedAt: "asc" }, { id: "asc" }];
    case "comingBack":
    case "returnOverdue":
      return [{ statusChangedAt: "asc" }, { id: "asc" }];
    case "inspectionPending":
    case "scanDiscrepancy":
      return [{ receivedBackAt: "asc" }, { id: "asc" }];
  }
}

export function parcelQueueWhere(queue: ParcelQueue, now: Date, policy: ParcelPolicy = DEFAULT_PARCEL_POLICY): Prisma.OrderWhereInput {
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
  switch (queue) {
    // Out with the courier longer than allowed: counted from the handover scan, or from booking for a parcel never scanned.
    case "stuckInTransit":
      return {
        ...booked,
        status: "SHIPPED",
        OR: [{ handedOverAt: { lt: daysAgo(policy.stuckInTransitDays) } }, { handedOverAt: null, courierBookedAt: { lt: daysAgo(policy.stuckInTransitDays) } }],
      };
    // Coming back, and the courier's return was reported (the order moved) longer ago than allowed.
    case "returnOverdue":
      return { AND: [parcelQueueWhere("comingBack", now, policy), { statusChangedAt: { lt: daysAgo(policy.returnNotBackDays) } }] };
    case "handoverPending":
      return {
        ...booked,
        handedOverAt: null,
        status: { in: OUT_STATUSES },
        courierBookedAt: { gte: new Date(now.getTime() - HANDOVER_WINDOW_DAYS * 86_400_000) },
      };
    case "comingBack":
      return {
        ...booked,
        receivedBackAt: null,
        OR: [
          // Cancelled after booking: every unit not yet restocked is on its way back.
          { status: "CANCELLED", items: { some: { restockedQuantity: { lt: prisma.orderItem.fields.quantity } } } },
          // A return, a partial delivery's undelivered units, a recorded customer return: returned but not yet restocked.
          { status: { in: ["RETURNED", "PARTIALLY_DELIVERED", "DELIVERED", "REFUNDED"] }, items: { some: { restockedQuantity: { lt: prisma.orderItem.fields.returnedQuantity } } } },
        ],
      };
    case "inspectionPending":
      return { receivedBackAt: { not: null }, returnInspectedAt: null };
    case "scanDiscrepancy":
      return {
        receivedBackAt: { not: null },
        returnInspectedAt: null,
        OR: [{ status: { in: OUT_STATUSES } }, { status: "DELIVERED", items: { none: { returnedQuantity: { gt: 0 } } } }],
      };
  }
}
