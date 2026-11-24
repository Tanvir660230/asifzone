import { z } from "zod";
import type { OrderStatus } from "./schemas/order";

/**
 * Order hold (docs/ORDER_HOLD.md). The customer asked us to wait — after payday, while they are away, until a date —
 * and the order should neither be called nor booked until then. A hold is not a status: a PENDING or CONFIRMED order
 * keeps its status and simply leaves the call queues and booking until someone ends the hold.
 *
 * Stock (owner decision 2026-11-22): units held for someone who may not buy are units a real buyer can't have. So only a
 * short first hold (a day) keeps them, or a hold the customer secured with an advance (up to a week). Every other hold
 * gives the units back to stock at once; ending the hold takes them back, and is refused when they were sold meanwhile.
 * Nothing here ever cancels, confirms or books an order on its own.
 */

export const ORDER_HOLD_REASONS = ["AFTER_PAYDAY", "AWAY", "ON_A_DATE", "DECIDING", "STOCK_COMING", "ADDRESS_PENDING", "OTHER"] as const;
export type OrderHoldReason = (typeof ORDER_HOLD_REASONS)[number];

export const ORDER_HOLD_REASON_LABELS: Record<OrderHoldReason, string> = {
  AFTER_PAYDAY: "After payday",
  AWAY: "Away from home",
  ON_A_DATE: "Wants it on a date",
  DECIDING: "Deciding size or colour",
  STOCK_COMING: "Waiting for stock",
  ADDRESS_PENDING: "Address to follow",
  OTHER: "Other",
};

/** Statuses a hold may be placed on: before the warehouse starts and before a courier is booked. */
export const HOLDABLE_STATUSES: readonly OrderStatus[] = ["PENDING", "CONFIRMED"];
/** The longest a hold may run. */
export const ORDER_HOLD_MAX_DAYS = 30;
/** Holds on one order before an owner or manager has to decide. */
export const ORDER_HOLD_MAX_COUNT = 2;
/** A first hold this short keeps the stock — the same wait as an ordinary unconfirmed order. */
export const ORDER_HOLD_KEEP_STOCK_HOURS = 24;
/** With an advance paid, the stock stays reserved for a hold up to this long. */
export const ORDER_HOLD_ADVANCE_KEEP_DAYS = 7;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type OrderHoldOutcome = "RESUMED" | "CONFIRMED" | "CANCELLED" | "TRASHED";

/** An advance secures the stock: at least the delivery charge received (any payment when delivery is free). */
export function holdAdvancePaid(netPaid: number, shippingFee: number): boolean {
  return netPaid > 0 && netPaid >= shippingFee;
}

/** Whether this hold keeps the order's stock reserved, or gives it back to sell to others. */
export function holdKeepsStock(input: { until: Date; now: Date; previousHolds: number; advancePaid: boolean }): boolean {
  const span = input.until.getTime() - input.now.getTime();
  if (input.previousHolds === 0 && span <= ORDER_HOLD_KEEP_STOCK_HOURS * HOUR) return true;
  if (input.advancePaid && span <= ORDER_HOLD_ADVANCE_KEEP_DAYS * DAY) return true;
  return false;
}

export interface OrderHoldFacts {
  status: OrderStatus;
  deletedAt: string | Date | null;
  courierConsignmentId: string | null;
  holdUntil?: string | Date | null;
  holdCount?: number;
}

/** Why a hold can't be placed (null: it can). `canOverride`: an owner/manager may hold past the count limit. */
export function placeHoldBlocker(order: OrderHoldFacts, opts: { canOverride?: boolean } = {}): string | null {
  if (order.deletedAt) return "Restore this order before making changes";
  if (order.holdUntil) return "This order is already on hold — end the hold or change it from the hold panel";
  if (!HOLDABLE_STATUSES.includes(order.status)) return "Only pending or confirmed orders can be put on hold";
  if (order.courierConsignmentId) return "A courier is booked for this order — unlink the booking before putting it on hold";
  if ((order.holdCount ?? 0) >= ORDER_HOLD_MAX_COUNT && !opts.canOverride) {
    return `This order has been on hold ${ORDER_HOLD_MAX_COUNT} times — an owner or manager decides on another one`;
  }
  return null;
}

/** The refusal for anything that would move a held order forward (booking, packing, shipping). */
export function onHoldBlocker(order: { holdUntil?: string | Date | null }): string | null {
  return order.holdUntil ? "This order is on hold — end the hold first" : null;
}

export type OrderHoldState = "none" | "held" | "due";

/** "due": the date the customer gave has come — call them and end the hold one way or the other. */
export function orderHoldState(order: { holdUntil?: string | Date | null }, now: Date = new Date()): OrderHoldState {
  if (!order.holdUntil) return "none";
  return new Date(order.holdUntil).getTime() <= now.getTime() ? "due" : "held";
}

export const placeOrderHoldSchema = z
  .object({
    reason: z.enum(ORDER_HOLD_REASONS),
    until: z.coerce.date(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.reason !== "OTHER" || Boolean(v.note), { message: "Say why the order is on hold", path: ["note"] });
export type PlaceOrderHoldInput = z.infer<typeof placeOrderHoldSchema>;

/** The date rules, checked by the server against its own clock (the schema can't know "now"). */
export function holdDateProblem(until: Date, now: Date): string | null {
  if (until.getTime() <= now.getTime()) return "Pick a date in the future";
  if (until.getTime() - now.getTime() > ORDER_HOLD_MAX_DAYS * DAY) return `A hold can run ${ORDER_HOLD_MAX_DAYS} days at most`;
  return null;
}
