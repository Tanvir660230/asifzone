import type { Prisma } from "@prisma/client";
import {
  DEFAULT_PARCEL_TIMING,
  ORDER_EXCEPTION_IDS,
  PRE_SHIPMENT_STATUSES,
  type OrderExceptionId,
  type OrderExceptionsBoard,
  type OrderStatus,
  type OperationsCount,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { HANDOVER_WINDOW_DAYS } from "./parcel-queues";

/**
 * The Exception Center (docs/WAREHOUSE_OPERATIONS.md §5): parcels whose facts disagree or have waited too long. Each
 * exception is one predicate over facts the order already records (packages/shared parcel-lifecycle.ts names the same
 * conditions per order). Read-only — finding an exception never changes an order; a person decides.
 *
 * Most are plain `where` clauses. The one that needs an age of Steadfast's current word (delivery confirmation late) is
 * resolved to order ids, because that age lives in CourierStatusChange, which has no relation to Order. The list filters
 * every exception by the ids this module returns, so a count always equals the list it opens.
 */

const OUT_STATUSES: OrderStatus[] = [...PRE_SHIPMENT_STATUSES, "SHIPPED"];
const booked = { courierConsignmentId: { not: null } } satisfies Prisma.OrderWhereInput;
const live = { deletedAt: null } satisfies Prisma.OrderWhereInput;
/** Steadfast words that say the parcel hasn't reached a delivery result yet — they never prove it left the building. */
const NO_RESULT_YET = [{ courierStatus: null }, { courierStatus: { in: ["pending", "in_review"] } }] satisfies Prisma.OrderWhereInput[];
/** An exception list never grows past this — a backlog that large is read in its own report, not a list filter. */
export const EXCEPTION_ID_LIMIT = 2000;

const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000);

/** The `where` for every exception that is a plain predicate (all but deliveryConfirmOverdue). */
function exceptionWhere(id: Exclude<OrderExceptionId, "deliveryConfirmOverdue">, now: Date): Prisma.OrderWhereInput {
  const t = DEFAULT_PARCEL_TIMING;
  switch (id) {
    // Booked over a day ago, within the scanning window, no handover recorded, and Steadfast hasn't reported a result.
    case "handoverOverdue":
      return {
        ...booked,
        status: { in: OUT_STATUSES },
        handedOverAt: null,
        receivedBackAt: null,
        courierBookedAt: { lt: hoursAgo(now, t.handoverOverdueHours), gte: hoursAgo(now, HANDOVER_WINDOW_DAYS * 24) },
        OR: NO_RESULT_YET,
      };
    case "courierOnHold":
      return { ...booked, status: { in: OUT_STATUSES }, courierStatus: "hold" };
    case "courierUnknown":
      return { ...booked, status: { in: OUT_STATUSES }, courierStatus: { in: ["unknown", "unknown_approval_pending"] } };
    case "courierSyncFailing":
      return { ...booked, status: { in: OUT_STATUSES }, courierSyncError: { not: null } };
    // Cancelled here; Steadfast still expects to collect it (its API has no cancel), and nothing says it ever left or came back.
    case "cancelInCourierPanel":
      return { ...booked, status: "CANCELLED", handedOverAt: null, receivedBackAt: null, OR: NO_RESULT_YET };
    case "inspectionOverdue":
      return { receivedBackAt: { lt: hoursAgo(now, t.inspectOverdueHours) }, returnInspectedAt: null };
    case "partialToReconcile":
      return { status: "PARTIALLY_DELIVERED", partialDeliveryReconciledAt: null };
    case "bookedButPacked":
      return { ...booked, status: { in: [...PRE_SHIPMENT_STATUSES] } };
    case "deliveredButCourierPartial":
      return { ...booked, status: "DELIVERED", courierStatus: "partial_delivered" };
    case "deliveredButCourierCancelled":
      return { ...booked, status: "DELIVERED", courierStatus: "cancelled" };
    case "deliveredWithoutCourierStatus":
      return { ...booked, status: "DELIVERED", courierStatus: null };
  }
}

/** The time an exception's age is counted from — the oldest one is shown next to the count. */
function exceptionAgeField(id: OrderExceptionId): "courierBookedAt" | "statusChangedAt" | "receivedBackAt" {
  if (id === "handoverOverdue" || id === "bookedButPacked") return "courierBookedAt";
  if (id === "inspectionOverdue") return "receivedBackAt";
  return "statusChangedAt";
}

/** Rider-reported deliveries Steadfast hasn't confirmed for longer than allowed. The age is from the newest recorded change
 * to the current word; a parcel whose change predates the status log falls back to its booking time. */
async function deliveryConfirmOverdue(now: Date): Promise<Array<{ id: string; since: Date }>> {
  const cutoff = hoursAgo(now, DEFAULT_PARCEL_TIMING.deliveryConfirmOverdueHours);
  const candidates = await prisma.order.findMany({
    where: { ...live, ...booked, status: { in: OUT_STATUSES }, courierStatus: { in: ["delivered_approval_pending", "partial_delivered_approval_pending"] } },
    select: { id: true, courierStatus: true, courierBookedAt: true, statusChangedAt: true },
    take: EXCEPTION_ID_LIMIT * 2,
  });
  if (candidates.length === 0) return [];
  const changes = await prisma.courierStatusChange.groupBy({
    by: ["orderId", "toStatus"],
    where: { orderId: { in: candidates.map((c) => c.id) } },
    _max: { observedAt: true },
  });
  const seen = new Map(changes.map((c) => [`${c.orderId}|${c.toStatus}`, c._max.observedAt]));
  return candidates
    .map((c) => ({ id: c.id, since: seen.get(`${c.id}|${c.courierStatus}`) ?? c.courierBookedAt ?? c.statusChangedAt }))
    .filter((c) => c.since < cutoff)
    .sort((a, b) => a.since.getTime() - b.since.getTime());
}

/** The order ids an exception matches, oldest first (the orders list's ?exception= filter). */
export async function exceptionOrderIds(id: OrderExceptionId, now = new Date()): Promise<string[]> {
  if (id === "deliveryConfirmOverdue") return (await deliveryConfirmOverdue(now)).slice(0, EXCEPTION_ID_LIMIT).map((r) => r.id);
  const field = exceptionAgeField(id);
  const rows = await prisma.order.findMany({
    where: { ...live, ...exceptionWhere(id, now) },
    select: { id: true },
    orderBy: [{ [field]: ageSort(field, "first") }, { id: "asc" }],
    take: EXCEPTION_ID_LIMIT,
  });
  return rows.map((r) => r.id);
}

async function countException(id: OrderExceptionId, now: Date): Promise<OperationsCount> {
  if (id === "deliveryConfirmOverdue") {
    const rows = await deliveryConfirmOverdue(now);
    return { count: rows.length, oldestAt: rows[0]?.since.toISOString() ?? null };
  }
  const where = { ...live, ...exceptionWhere(id, now) };
  const field = exceptionAgeField(id);
  const [count, oldest] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findFirst({ where, select: { [field]: true }, orderBy: { [field]: ageSort(field, "last") } }) as Promise<Record<string, Date | null> | null>,
  ]);
  return { count, oldestAt: oldest?.[field]?.toISOString() ?? null };
}

export async function getOrderExceptionsBoard(now = new Date()): Promise<OrderExceptionsBoard> {
  const counts = await Promise.all(ORDER_EXCEPTION_IDS.map((id) => countException(id, now)));
  return {
    generatedAt: now.toISOString(),
    exceptions: Object.fromEntries(ORDER_EXCEPTION_IDS.map((id, i) => [id, counts[i]!])) as OrderExceptionsBoard["exceptions"],
  };
}

/** statusChangedAt is never null; the other age fields may be (Prisma only takes `nulls` on a nullable column). */
function ageSort(field: ReturnType<typeof exceptionAgeField>, nulls: "first" | "last") {
  return field === "statusChangedAt" ? ("asc" as const) : { sort: "asc" as const, nulls };
}
