import type { Prisma } from "@prisma/client";
import {
  ORDER_HOLD_REASON_LABELS,
  formatDateTime,
  holdAdvancePaid,
  holdDateProblem,
  holdKeepsStock,
  placeHoldBlocker,
  type OrderHoldOutcome,
  type OrderHoldReason,
  type OrderStatus,
  type PlaceOrderHoldInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { getTimezone } from "../../domain/config/commerce-settings";
// Not courier.service: that module imports order.service, and order.service imports this one.
import { COURIER_BOOKING_LEASE_MS } from "../courier/booking-lease";
import { notifyReplenished, notifyStockMoved, releaseOrderLines, reReserveOrderLines } from "../inventory/inventory.service";
import { getOrderById } from "./order.service";

/**
 * Order hold (docs/ORDER_HOLD.md): the customer asked us to wait until a date. The order keeps its status (PENDING or
 * CONFIRMED) and leaves the call queues and booking until someone ends the hold. A short first hold, or one secured with
 * an advance, keeps the stock; any other gives it back to sell at once, and ending the hold takes it back — refused while
 * it is sold out. Ending is always a person's act (or the state machine's, when the order is confirmed or cancelled):
 * nothing here confirms, cancels or books on its own.
 */

type Tx = Prisma.TransactionClient;

interface LockedHoldRow {
  status: OrderStatus;
  deletedAt: Date | null;
  courierConsignmentId: string | null;
  courierBookingStartedAt: Date | null;
  holdUntil: Date | null;
  holdCount: number;
  holdStockReleased: boolean;
}

async function lockHoldRow(tx: Tx, orderId: string): Promise<LockedHoldRow> {
  const [row] = await tx.$queryRaw<LockedHoldRow[]>`
    SELECT status, "deletedAt", "courierConsignmentId", "courierBookingStartedAt", "holdUntil", "holdCount", "holdStockReleased"
    FROM "Order" WHERE id = ${orderId} FOR UPDATE
  `;
  if (!row) throw AppError.notFound("Order not found");
  return row;
}

/** Puts an order on hold. `canOverride` (owner/manager): a hold past the two-hold limit. */
export async function placeOrderHold(orderId: string, input: PlaceOrderHoldInput, adminId: string, opts: { canOverride?: boolean } = {}) {
  const now = new Date();
  const dateProblem = holdDateProblem(input.until, now);
  if (dateProblem) throw AppError.badRequest(dateProblem, { code: "HOLD_DATE" });
  // The advance is read from the payment ledger before the lock; a payment landing mid-call only makes keeping stock
  // more justified, never less.
  const before = await getOrderById(orderId);
  const advancePaid = holdAdvancePaid(before.payment.netPaid, Number(before.shippingFee));
  const timeZone = await getTimezone();

  let moved: string[] = [];
  let replenished: string[] = [];
  await prisma.$transaction(async (tx) => {
    const row = await lockHoldRow(tx, orderId);
    const blocker = placeHoldBlocker(row, opts);
    if (blocker) throw new AppError(409, blocker, { code: "HOLD_REFUSED" });
    if (row.courierBookingStartedAt && now.getTime() - row.courierBookingStartedAt.getTime() < COURIER_BOOKING_LEASE_MS) {
      throw new AppError(409, "A courier booking for this order is in progress — wait a moment and try again", { code: "HOLD_REFUSED" });
    }

    const keep = holdKeepsStock({ until: input.until, now, previousHolds: row.holdCount, advancePaid });
    const untilText = formatDateTime(input.until, timeZone);
    if (!keep) {
      const result = await releaseOrderLines(tx, orderId, "release", { adminId, note: `Stock released — order on hold until ${untilText}` });
      moved = result.released.map((r) => r.variantId);
      replenished = result.replenished;
    }
    const label = ORDER_HOLD_REASON_LABELS[input.reason as OrderHoldReason];
    const note = `On hold until ${untilText} — ${label}${input.note ? `: ${input.note}` : ""} · ${keep ? "stock kept" : "stock released for other buyers"}`;
    await tx.orderHold.create({ data: { orderId, reason: input.reason, note: input.note || null, until: input.until, stockReleased: !keep, startedById: adminId } });
    await tx.order.update({
      where: { id: orderId },
      data: {
        holdUntil: input.until,
        holdReason: input.reason,
        holdNote: input.note || null,
        holdStartedAt: now,
        holdStockReleased: !keep,
        holdCount: { increment: 1 },
        // A pending order comes back as a due callback on the date (Call now), and the age rule waits until a day after it.
        ...(row.status === "PENDING" ? { followUpAt: input.until, confirmationReprieveUntil: new Date(input.until.getTime() + 24 * 3_600_000) } : {}),
        confirmationClaimedById: null,
        confirmationClaimedAt: null,
        statusHistory: { create: { status: row.status, note, changedByAdminId: adminId } },
      },
    });
  });
  notifyReplenished(replenished);
  notifyStockMoved(moved);
  return getOrderById(orderId);
}

/**
 * Ends the open hold inside the caller's transaction (the order row already locked). `RESUMED` and `CONFIRMED` take back
 * the stock the hold released — all-or-nothing, a 409 when any of it was sold since; `CANCELLED` and `TRASHED` leave it
 * with the shelf (their own release finds nothing outstanding). No-op when the order isn't on hold.
 */
export async function endHoldInTx(tx: Tx, orderId: string, outcome: OrderHoldOutcome, adminId: string | null | undefined): Promise<string[]> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, holdUntil: true, holdStockReleased: true } });
  if (!order.holdUntil) return [];
  let moved: string[] = [];
  if (order.holdStockReleased && (outcome === "RESUMED" || outcome === "CONFIRMED")) {
    try {
      moved = await reReserveOrderLines(tx, orderId, { adminId: adminId ?? undefined, note: "Stock re-reserved — hold ended" });
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 409) {
        throw new AppError(409, "This order's items were sold while it was on hold — add stock, or change or cancel the order", { code: "HOLD_SOLD_OUT" });
      }
      throw err;
    }
  }
  const now = new Date();
  await tx.orderHold.updateMany({ where: { orderId, endedAt: null }, data: { endedAt: now, endedById: adminId ?? null, outcome } });
  await tx.order.update({
    where: { id: orderId },
    data: {
      holdUntil: null,
      holdReason: null,
      holdNote: null,
      holdStartedAt: null,
      holdStockReleased: false,
      ...(outcome === "RESUMED" && order.status === "PENDING"
        ? // Back to Call now, and a day before the age rule can escalate it.
          { followUpAt: null, confirmationReprieveUntil: new Date(now.getTime() + 24 * 3_600_000) }
        : {}),
      ...(outcome === "RESUMED" ? { statusHistory: { create: { status: order.status, note: "Hold ended", changedByAdminId: adminId ?? null } } } : {}),
    },
  });
  return moved;
}

/** "End hold": the order goes back to its queue with its stock (409 HOLD_SOLD_OUT when it is gone). Idempotent. */
export async function endOrderHold(orderId: string, adminId: string) {
  let moved: string[] = [];
  await prisma.$transaction(async (tx) => {
    const row = await lockHoldRow(tx, orderId);
    if (row.deletedAt) throw AppError.badRequest("Restore this order before making changes");
    moved = await endHoldInTx(tx, orderId, "RESUMED", adminId);
  });
  notifyStockMoved(moved);
  return getOrderById(orderId);
}

/** The hold side of the state machine (applyOrderTransition, row already locked): confirming ends the hold and takes its
 * stock back; cancelling ends it; any other forward move is refused while the order is on hold. */
export async function holdTransitionEffect(tx: Tx, orderId: string, to: OrderStatus, adminId: string | null | undefined): Promise<string[]> {
  const row = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { holdUntil: true } });
  if (!row.holdUntil) return [];
  if (to === "CONFIRMED") return endHoldInTx(tx, orderId, "CONFIRMED", adminId);
  if (to === "CANCELLED") return endHoldInTx(tx, orderId, "CANCELLED", adminId);
  if (to === "PENDING") return [];
  throw new AppError(409, "This order is on hold — end the hold first", { code: "ON_HOLD" });
}
