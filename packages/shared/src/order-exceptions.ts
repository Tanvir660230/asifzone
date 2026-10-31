import type { OrderQueueId } from "./order-operations";

/**
 * Today's Operations (Warehouse Operations, docs/WAREHOUSE_OPERATIONS.md §5): the day's order work as five stages in
 * the order it happens, plus the Exception Center — facts that disagree or have waited too long. Each item is either an
 * existing orders-list queue (`queue`) or an exception (`exception`, filtered with ?exception=<id>); the API counts each
 * one with the same predicate the list filters by, so a count always equals the list it opens.
 */

export const ORDER_EXCEPTION_IDS = [
  "handoverOverdue",
  "courierOnHold",
  "courierUnknown",
  "deliveryConfirmOverdue",
  "courierSyncFailing",
  "cancelInCourierPanel",
  "inspectionOverdue",
  "partialToReconcile",
  "bookedButPacked",
  "deliveredButCourierPartial",
  "deliveredButCourierCancelled",
  "deliveredWithoutCourierStatus",
] as const;
export type OrderExceptionId = (typeof ORDER_EXCEPTION_IDS)[number];

export const ORDER_EXCEPTION_INFO: Readonly<Record<OrderExceptionId, { label: string; meaning: string; action: string }>> = {
  handoverOverdue: {
    label: "Booked, no handover recorded",
    meaning: "Booked more than a day ago, no handover recorded, and no delivery result from Steadfast yet.",
    action: "Find the parcel. Scan it out when the rider takes it, or cancel the booking if it isn't going.",
  },
  courierOnHold: {
    label: "On hold at the courier",
    meaning: "Steadfast paused the delivery — usually the address or the phone.",
    action: "Call the customer, then update the parcel in Steadfast.",
  },
  courierUnknown: {
    label: "Unknown courier status",
    meaning: "Steadfast reported a result it hasn't classified. It is never counted as delivered or returned.",
    action: "Look the parcel up in the Steadfast panel or ask Steadfast support.",
  },
  deliveryConfirmOverdue: {
    label: "Delivery confirmation late",
    meaning: "The rider marked it delivered (or partly) over three days ago and Steadfast still hasn't confirmed.",
    action: "Ask Steadfast to confirm. The order stays open until they do.",
  },
  courierSyncFailing: {
    label: "Courier sync failing",
    meaning: "The last status check with Steadfast failed — what is shown may be stale.",
    action: "Sync now. If it keeps failing, check the booking in the Steadfast panel.",
  },
  cancelInCourierPanel: {
    label: "Cancelled, still booked",
    meaning: "Cancelled here, but Steadfast still expects to collect it. Steadfast's API can't cancel a booking.",
    action: "Cancel it in the Steadfast panel — or, if the rider already took it, receive it when it comes back.",
  },
  inspectionOverdue: {
    label: "Back, not inspected",
    meaning: "Scanned back in more than two days ago and still not inspected, so nothing returned to stock.",
    action: "Open the parcel and inspect each item.",
  },
  partialToReconcile: {
    label: "Partial delivery to reconcile",
    meaning: "The customer kept part of the order. Until someone says which units came back, they are neither sold nor in stock.",
    action: "Open it and say what the customer kept — or receive the parcel on Returns in, which asks the same.",
  },
  bookedButPacked: {
    label: "Booked but still Packed",
    meaning: "A courier booking exists but the order never moved on — mostly bookings from before booking marked it shipped.",
    action: "Check the parcel in Steadfast and move the order to its real status.",
  },
  deliveredButCourierPartial: {
    label: "Delivered here, partial at courier",
    meaning: "The order says Delivered but Steadfast says the customer kept only part of it.",
    action: "Compare with the Steadfast panel. If units came back, record them — nothing is changed automatically.",
  },
  deliveredButCourierCancelled: {
    label: "Delivered here, cancelled at courier",
    meaning: "The order says Delivered but Steadfast says the delivery was cancelled.",
    action: "Compare with the Steadfast panel and the COD payout before correcting the order.",
  },
  deliveredWithoutCourierStatus: {
    label: "Delivered, courier silent",
    meaning: "Booked with Steadfast and marked Delivered, but Steadfast never reported any status for it.",
    action: "Sync it. If Steadfast has no record, note how it was really delivered.",
  },
};

export type OperationsStageId = "confirm" | "prepare" | "dispatch" | "delivery" | "returns";

export type OperationsItemRef = { queue: OrderQueueId } | { exception: OrderExceptionId };

export interface OperationsStageDef {
  id: OperationsStageId;
  label: string;
  /** The stage's main count — the work this stage exists for. */
  primary: OperationsItemRef & { label: string };
  /** Smaller lines under it: what is late or blocked in this stage. */
  more: ReadonlyArray<OperationsItemRef & { label: string }>;
}

export const OPERATIONS_STAGES: readonly OperationsStageDef[] = [
  {
    id: "confirm",
    label: "Call",
    primary: { queue: "callNow", label: "customers to call" },
    more: [
      { queue: "callLater", label: "callbacks set" },
      { queue: "confirmEscalated", label: "escalated" },
    ],
  },
  { id: "prepare", label: "Book", primary: { queue: "readyToBook", label: "confirmed, not booked" }, more: [] },
  {
    id: "dispatch",
    label: "Hand over",
    primary: { queue: "handoverPending", label: "booked, not with the rider yet" },
    more: [{ exception: "handoverOverdue", label: "over a day" }],
  },
  {
    id: "delivery",
    label: "With the courier",
    primary: { queue: "stuckInTransit", label: "out too long" },
    more: [
      { exception: "courierOnHold", label: "on hold" },
      { exception: "courierUnknown", label: "unknown status" },
      { exception: "deliveryConfirmOverdue", label: "confirmation late" },
      { exception: "courierSyncFailing", label: "sync failing" },
    ],
  },
  {
    id: "returns",
    label: "Returns",
    primary: { queue: "comingBack", label: "coming back" },
    more: [
      { queue: "inspectionPending", label: "to inspect" },
      { exception: "partialToReconcile", label: "partial to reconcile" },
      { queue: "returnOverdue", label: "overdue" },
    ],
  },
];

/** The Exception Center: facts that disagree with each other. Time-based courier problems are counted in their stage above,
 * so nothing is listed twice; nothing here is corrected automatically. */
export const EXCEPTION_CENTER_IDS: readonly OrderExceptionId[] = [
  "cancelInCourierPanel",
  "inspectionOverdue",
  "deliveredButCourierPartial",
  "deliveredButCourierCancelled",
  "bookedButPacked",
  "deliveredWithoutCourierStatus",
];

export interface OperationsCount {
  count: number;
  /** The oldest matching order's relevant time (booking, status change…), ISO — the age shown next to the count. */
  oldestAt: string | null;
}

/** GET /api/v1/orders/exceptions. Queue counts come from GET /api/v1/orders/stats (`queueCounts`), as on the list. */
export interface OrderExceptionsBoard {
  generatedAt: string;
  exceptions: Record<OrderExceptionId, OperationsCount>;
}
