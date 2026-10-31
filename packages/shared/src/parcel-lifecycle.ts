import { PRE_SHIPMENT_STATUSES } from "./order-state";
import type { OrderStatus } from "./schemas/order";

/**
 * Where a parcel really is (Warehouse Operations, docs/WAREHOUSE_OPERATIONS.md §2). The order status answers "what did
 * the business decide" (SHIPPED is set at booking — owner decision D-AA3 — and drives the courier sync and the
 * cancellation rules), so it can't also answer "is the parcel still on our shelf". This reads the physical and courier
 * facts the order already records — booking, the handover scan, Steadfast's own word, the return scan and inspection —
 * and names the one stage they add up to, with its age, priority and the next thing a person should do.
 *
 * Nothing here is stored and nothing here moves stock, money or status: it is a presentation of existing facts, shared
 * by the API (exception center, today's operations) and the admin UI so the two can't drift.
 *
 * What Steadfast cannot tell us, and so this never claims:
 *  - `pending` is both "waiting for the rider" and "the rider has it" — Steadfast has no pickup status. Only our own
 *    handover scan says the parcel left the building.
 *  - `cancelled` is both "cancelled before pickup" and "failed delivery, coming back". Only the return scan says it's back.
 *  - `*_approval_pending` is the rider's word, not Steadfast's confirmation — the order doesn't move on it.
 */

export type ParcelStage =
  | "NOT_BOOKED"
  | "BOOKED_WITH_US"
  | "WITH_COURIER"
  | "ON_HOLD"
  | "DELIVERY_CONFIRMING"
  | "CANCEL_CONFIRMING"
  | "UNKNOWN"
  | "DELIVERED"
  | "PARTIAL_TO_RECONCILE"
  | "CANCEL_IN_COURIER_PANEL"
  | "RETURNING"
  | "RETURN_TO_INSPECT"
  | "CLOSED";

export type ParcelTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface ParcelFacts {
  status: OrderStatus;
  courierConsignmentId: string | null;
  courierStatus: string | null;
  courierSyncError?: string | null;
  courierBookedAt: string | Date | null;
  handedOverAt: string | Date | null;
  receivedBackAt: string | Date | null;
  returnInspectedAt: string | Date | null;
  partialDeliveryReconciledAt: string | Date | null;
  statusChangedAt: string | Date | null;
  /** When Steadfast's current word was first seen (the newest CourierStatusChange) — optional; falls back to the order. */
  courierStatusSince?: string | Date | null;
  /** Units the courier still owes back (returned or cancelled-after-shipping, not yet restocked) — from the line items. */
  unitsExpectedBack?: number;
}

/** How long each stage may last before it is late (StoreSetting where one exists; these are the defaults). */
export interface ParcelTimingPolicy {
  /** Booked but not handed over: the rider normally collects the same or next day. */
  handoverOverdueHours: number;
  /** The rider's "delivered / partly delivered" waiting for Steadfast's confirmation. */
  deliveryConfirmOverdueHours: number;
  /** `unknown` and on-hold parcels are chased the same day. */
  courierAttentionHours: number;
  /** StoreSetting.stuckInTransitDays. */
  stuckInTransitDays: number;
  /** StoreSetting.returnNotBackDays. */
  returnNotBackDays: number;
  /** Back with us but not inspected. */
  inspectOverdueHours: number;
}

export const DEFAULT_PARCEL_TIMING: ParcelTimingPolicy = {
  handoverOverdueHours: 24,
  deliveryConfirmOverdueHours: 72,
  courierAttentionHours: 24,
  stuckInTransitDays: 6,
  returnNotBackDays: 14,
  inspectOverdueHours: 48,
};

export interface ParcelStageView {
  stage: ParcelStage;
  label: string;
  meaning: string;
  tone: ParcelTone;
  /** What a person should do now, or null when nothing (the parcel is moving as it should). */
  nextAction: string | null;
  /** 0 nothing to do · 1 today's routine work · 2 needs a person soon · 3 late or blocked. */
  priority: 0 | 1 | 2 | 3;
  /** When this stage started, as far as the facts show. */
  since: Date | null;
  ageHours: number | null;
  overdue: boolean;
  /** Facts that disagree with each other (shown, never "fixed" automatically). */
  conflicts: ParcelConflict[];
}

export type ParcelConflict =
  | "BOOKED_BUT_PACKED"
  | "DELIVERED_BUT_COURIER_PARTIAL"
  | "DELIVERED_BUT_COURIER_CANCELLED"
  | "DELIVERED_WITHOUT_COURIER_STATUS"
  | "BACK_BUT_COURIER_SAYS_OUT";

export const PARCEL_CONFLICT_LABEL: Record<ParcelConflict, string> = {
  BOOKED_BUT_PACKED: "Booked with the courier but the order is still Packed",
  DELIVERED_BUT_COURIER_PARTIAL: "Marked delivered, but the courier reports a partial delivery",
  DELIVERED_BUT_COURIER_CANCELLED: "Marked delivered, but the courier reports it cancelled",
  DELIVERED_WITHOUT_COURIER_STATUS: "Booked and marked delivered, but the courier never reported a status",
  BACK_BUT_COURIER_SAYS_OUT: "Scanned back in, but the courier still reports it out or delivered",
};

const at = (v: string | Date | null | undefined): Date | null => (v ? new Date(v) : null);
const OUT_STATUSES: readonly OrderStatus[] = [...PRE_SHIPMENT_STATUSES, "SHIPPED"];

export function parcelConflicts(f: ParcelFacts): ParcelConflict[] {
  const out: ParcelConflict[] = [];
  if (f.courierConsignmentId && PRE_SHIPMENT_STATUSES.includes(f.status)) out.push("BOOKED_BUT_PACKED");
  if (f.status === "DELIVERED" && f.courierConsignmentId) {
    if (f.courierStatus === "partial_delivered") out.push("DELIVERED_BUT_COURIER_PARTIAL");
    else if (f.courierStatus === "cancelled") out.push("DELIVERED_BUT_COURIER_CANCELLED");
    else if (!f.courierStatus) out.push("DELIVERED_WITHOUT_COURIER_STATUS");
  }
  if (f.receivedBackAt && !f.returnInspectedAt && OUT_STATUSES.includes(f.status)) out.push("BACK_BUT_COURIER_SAYS_OUT");
  return out;
}

/** The one stage a parcel is in, with its age and the next thing to do. Pure: same facts and `now`, same answer. */
export function describeParcel(f: ParcelFacts, now: Date = new Date(), policy: ParcelTimingPolicy = DEFAULT_PARCEL_TIMING): ParcelStageView {
  const conflicts = parcelConflicts(f);
  const view = (
    stage: ParcelStage,
    p: { label: string; meaning: string; tone: ParcelTone; nextAction: string | null; priority: ParcelStageView["priority"]; since: Date | null; lateAfterHours?: number },
  ): ParcelStageView => {
    const ageHours = p.since ? Math.max(0, (now.getTime() - p.since.getTime()) / 3_600_000) : null;
    const overdue = p.lateAfterHours !== undefined && ageHours !== null && ageHours > p.lateAfterHours;
    const priority = (overdue ? 3 : Math.max(p.priority, conflicts.length > 0 ? 2 : 0)) as ParcelStageView["priority"];
    return { stage, label: p.label, meaning: p.meaning, tone: overdue && p.tone !== "danger" ? "warning" : p.tone, nextAction: p.nextAction, priority, since: p.since, ageHours, overdue, conflicts };
  };
  const courierSince = at(f.courierStatusSince) ?? at(f.statusChangedAt);
  const cs = f.courierStatus;
  const booked = Boolean(f.courierConsignmentId);
  const out = OUT_STATUSES.includes(f.status);

  // Physically back — the return scan is the only proof, whatever the order or the courier says.
  if (f.receivedBackAt && !f.returnInspectedAt) {
    return view("RETURN_TO_INSPECT", {
      label: "Back with us · inspect",
      meaning: "The parcel is physically back. Its units return to stock only after each one is inspected.",
      tone: "warning",
      nextAction: "Open the parcel and inspect each item",
      priority: 2,
      since: at(f.receivedBackAt),
      lateAfterHours: policy.inspectOverdueHours,
    });
  }

  if (out) {
    if (!booked) {
      return view("NOT_BOOKED", { label: "Not booked", meaning: "No courier booking yet.", tone: "neutral", nextAction: null, priority: 0, since: null });
    }
    if (f.courierSyncError) {
      return view("UNKNOWN", {
        label: "Courier sync failing",
        meaning: "The last status check with the courier failed, so what is shown may be out of date.",
        tone: "danger",
        nextAction: "Sync now; if it keeps failing, check the booking in the Steadfast panel",
        priority: 3,
        since: courierSince,
      });
    }
    if (cs === "hold") {
      return view("ON_HOLD", {
        label: "On hold · action needed",
        meaning: "Steadfast has paused the delivery — usually a wrong address or an unreachable phone.",
        tone: "danger",
        nextAction: "Call the customer, then update Steadfast",
        priority: 3,
        since: courierSince,
      });
    }
    if (cs === "unknown" || cs === "unknown_approval_pending") {
      return view("UNKNOWN", {
        label: "Unknown · investigate",
        meaning: "Steadfast reported a result it hasn't classified. It is never treated as delivered or returned.",
        tone: "warning",
        nextAction: "Check the parcel in the Steadfast panel or call Steadfast support",
        priority: 2,
        since: courierSince,
        lateAfterHours: policy.courierAttentionHours,
      });
    }
    if (cs === "delivered_approval_pending" || cs === "partial_delivered_approval_pending") {
      const partial = cs.startsWith("partial");
      return view("DELIVERY_CONFIRMING", {
        label: partial ? "Partly delivered · confirming" : "Delivered · confirming",
        meaning: "The rider's word, not yet confirmed by Steadfast — the order stays open until it is.",
        tone: "info",
        nextAction: null,
        priority: 0,
        since: courierSince,
        lateAfterHours: policy.deliveryConfirmOverdueHours,
      });
    }
    if (cs === "cancelled_approval_pending") {
      return view("CANCEL_CONFIRMING", {
        label: "Delivery failed · confirming",
        meaning: "The rider reported a failed or cancelled delivery; Steadfast hasn't confirmed it yet. The parcel is still out.",
        tone: "warning",
        nextAction: null,
        priority: 1,
        since: courierSince,
        lateAfterHours: policy.deliveryConfirmOverdueHours,
      });
    }
    if (!f.handedOverAt) {
      return view("BOOKED_WITH_US", {
        label: cs === "in_review" ? "Booked · under review · still with us" : "Booked · still with us",
        meaning: "Booked with the courier, but no handover has been recorded — as far as the system knows, the parcel is on our shelf.",
        tone: "warning",
        nextAction: "Hand it to the rider and scan it out",
        priority: 1,
        since: at(f.courierBookedAt),
        lateAfterHours: policy.handoverOverdueHours,
      });
    }
    return view("WITH_COURIER", {
      label: "With the courier",
      meaning: "Handed over and on its way. Steadfast doesn't report pickup or transit separately — the next word is the delivery result.",
      tone: "info",
      nextAction: null,
      priority: 0,
      since: at(f.handedOverAt),
      lateAfterHours: policy.stuckInTransitDays * 24,
    });
  }

  if (f.status === "PARTIALLY_DELIVERED" && !f.partialDeliveryReconciledAt) {
    return view("PARTIAL_TO_RECONCILE", {
      label: "Partly delivered · reconcile",
      meaning: "The customer kept part of the order. Say which units came back before anything else happens to them.",
      tone: "warning",
      nextAction: "Reconcile which units came back",
      priority: 2,
      since: at(f.statusChangedAt),
    });
  }

  if (f.status === "CANCELLED" && booked && !f.handedOverAt && !f.receivedBackAt && (cs === "pending" || cs === "in_review" || !cs)) {
    return view("CANCEL_IN_COURIER_PANEL", {
      label: "Cancelled · still booked with courier",
      meaning: "The order is cancelled but Steadfast still expects to collect it (its API can't cancel a booking). If the rider already has it, it will come back.",
      tone: "danger",
      nextAction: "Cancel the booking in the Steadfast panel, or receive the parcel when it returns",
      priority: 3,
      since: at(f.statusChangedAt),
    });
  }

  if ((f.unitsExpectedBack ?? 0) > 0 && !f.receivedBackAt) {
    return view("RETURNING", {
      label: "Coming back",
      meaning: "Units are on their way back from the courier. They return to stock only after they arrive and are inspected.",
      tone: "info",
      nextAction: "Scan it in when it arrives",
      priority: 1,
      since: at(f.statusChangedAt),
      lateAfterHours: policy.returnNotBackDays * 24,
    });
  }

  if (f.status === "DELIVERED" || f.status === "PARTIALLY_DELIVERED") {
    return view("DELIVERED", {
      label: f.status === "DELIVERED" ? "Delivered" : "Partly delivered · reconciled",
      meaning: "With the customer.",
      tone: "success",
      nextAction: conflicts.length > 0 ? "Compare with the Steadfast panel and correct the order" : null,
      priority: 0,
      since: at(f.statusChangedAt),
    });
  }

  return view("CLOSED", { label: "Closed", meaning: "Nothing left to do with this parcel.", tone: "neutral", nextAction: null, priority: 0, since: at(f.statusChangedAt) });
}
