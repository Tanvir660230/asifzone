/**
 * How a door swap ends (docs/superpowers/plans/2026-11-28-door-swap-exchange.md, phase B). Every situation at the door:
 *
 *   SWAPPED     the rider took the old item and only the exchange amount (Steadfast COD lowered) — the old item is
 *               expected back on the original order (scan it there; the replacement parcel's code redirects).
 *   KEPT_BOTH   the customer kept the old item and paid for the new one too — the replacement becomes an ordinary sale
 *               at the full price, the old item stays sold.
 *   REFUSED     the customer didn't take the new item (and kept the old) — the new item comes back on its parcel, the old
 *               item stays sold.
 *   CANCELLED   called off before the replacement left the shop — its stock goes back, nothing else changes.
 *   OLD_MISSING swapped, but the old item hasn't come back after OLD_ITEM_DAYS — chase the courier / customer.
 *   OLD_RECEIVED the old item was scanned in (the receive step sets it).
 *
 * Steadfast tells us some of this by itself (reviewDoorSwaps, every 15 minutes with the courier sync): delivered with the
 * COD lowered → SWAPPED; cancelled / returned → REFUSED; delivered at the full protected amount → left for a person, as
 * either "kept both" or "the rider forgot to lower the COD" (swapNote says which to check). Staff can set any allowed
 * outcome by hand from the order page.
 */
import type { Prisma, SwapStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { notify } from "../../lib/notify";
import { captureError } from "../../lib/observability/error-capture";
import { refreshPaymentStatus } from "../../domain/payments/payment-ledger.service";
import { applyOrderTransition, runTransitionSideEffects } from "../orders/order.service";

export const OLD_ITEM_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRE_SHIP = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"];

export type SwapOutcome = "SWAPPED" | "KEPT_BOTH" | "REFUSED" | "CANCELLED" | "OLD_MISSING" | "OLD_RECEIVED";

/** Which outcomes may follow which (a person may correct the courier's reading, never undo a finished money change). */
const NEXT: Record<SwapStatus, readonly SwapOutcome[]> = {
  AWAITING_SWAP: ["SWAPPED", "KEPT_BOTH", "REFUSED", "CANCELLED"],
  SWAPPED: ["OLD_RECEIVED", "OLD_MISSING", "KEPT_BOTH"],
  OLD_MISSING: ["OLD_RECEIVED", "KEPT_BOTH"],
  KEPT_BOTH: [],
  REFUSED: [],
  CANCELLED: [],
  OLD_RECEIVED: [],
};

/** Gives back units an exchange had counted as "coming back" that never will (kept both, refused, cancelled). Only units
 * not yet received can be given back; conditional on the value read, like recordReturnDecision. */
async function undoReturnDecision(tx: Prisma.TransactionClient, orderItemId: string, quantity: number) {
  const item = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, select: { returnedQuantity: true, restockedQuantity: true } });
  const out = item.returnedQuantity - item.restockedQuantity;
  if (out < quantity) throw AppError.conflict("The old item has already been received — this exchange can't be changed that way");
  const r = await tx.orderItem.updateMany({ where: { id: orderItemId, returnedQuantity: item.returnedQuantity }, data: { returnedQuantity: { decrement: quantity } } });
  if (r.count === 0) throw AppError.conflict("The order changed at the same moment — try again");
}

export interface SettleBy {
  adminId: string | null;
  source: "STAFF" | "COURIER" | "SCAN" | "SWEEP";
}

export async function settleDoorSwap(requestId: string, outcome: SwapOutcome, by: SettleBy, note?: string | null) {
  const request = await prisma.returnRequest.findUnique({
    where: { id: requestId },
    include: { order: { select: { id: true, orderNumber: true, items: { select: { id: true, quantity: true } } } }, exchangeOrder: { select: { id: true, orderNumber: true, status: true, courierConsignmentId: true } } },
  });
  if (!request || !request.swap || !request.swapStatus) throw AppError.notFound("Exchange not found");
  if (request.swapStatus === outcome) return request;
  if (!NEXT[request.swapStatus].includes(outcome)) {
    throw new AppError(409, `This exchange is "${request.swapStatus.toLowerCase().replace(/_/g, " ")}" — it can't become "${outcome.toLowerCase().replace(/_/g, " ")}"`, { code: "SWAP_OUTCOME_NOT_ALLOWED" });
  }
  const replacement = request.exchangeOrder;
  const line = request.order.items.find((i) => i.id === request.orderItemId);
  if (!line) throw AppError.badRequest("The original item could not be found");
  if (outcome === "CANCELLED") {
    if (!replacement || !PRE_SHIP.includes(replacement.status)) throw AppError.conflict("The replacement has already left the shop — mark it refused when the parcel comes back");
    if (replacement.courierConsignmentId) throw AppError.conflict("Cancel the Steadfast parcel first, then cancel the exchange");
  }

  const stamp = `${new Date().toISOString().slice(0, 16).replace("T", " ")} ${by.source.toLowerCase()}`;
  const transitions: Awaited<ReturnType<typeof applyOrderTransition>>[] = [];
  await prisma.$transaction(async (tx) => {
    if (outcome === "KEPT_BOTH" || outcome === "REFUSED" || outcome === "CANCELLED") {
      // The old item stays with the customer (and stays sold).
      await undoReturnDecision(tx, line.id, line.quantity);
    }
    if (outcome === "KEPT_BOTH" && replacement) {
      // The replacement becomes an ordinary sale at the protected price (fee + full new price). Unlinking it from the
      // request is what makes every sales figure and the books count it (they skip orders linked as exchange replacements).
      const total = Number(request.protectedCod ?? 0);
      const o = await tx.order.findUniqueOrThrow({ where: { id: replacement.id }, select: { subtotal: true, shippingFee: true, adminNotes: true } });
      await tx.order.update({
        where: { id: replacement.id },
        data: {
          discount: Math.max(0, Number(o.subtotal) + Number(o.shippingFee) - total),
          total,
          adminNotes: `${o.adminNotes ?? ""}\nCustomer kept both items — sold at ${total} (${stamp})`.trim(),
        },
      });
      await refreshPaymentStatus(tx, replacement.id);
    }
    if (outcome === "CANCELLED" && replacement) {
      transitions.push(await applyOrderTransition(tx, replacement.id, { status: "CANCELLED", note: "Exchange called off before it left the shop" }, { adminId: by.adminId ?? undefined }));
    }
    await tx.returnRequest.update({
      where: { id: request.id },
      data: {
        swapStatus: outcome,
        swapSettledAt: new Date(),
        swapNote: note ?? null,
        ...(outcome === "KEPT_BOTH" && replacement ? { exchangeOrderId: null, keptOrderId: replacement.id } : {}),
      },
    });
  });
  for (const t of transitions) await runTransitionSideEffects(t).catch((err) => captureError(err, { msg: `[door-swap] side effects ${request.id}:` }));
  if (outcome === "OLD_MISSING") {
    notify({
      type: "system.notice",
      title: `Old item not back: exchange for ${request.order.orderNumber}`,
      body: `Swapped ${OLD_ITEM_DAYS}+ days ago and the old item hasn't been scanned in — ask Steadfast for it.`,
      link: `/admin/orders/${request.order.id}`,
    });
  }
  return prisma.returnRequest.findUniqueOrThrow({ where: { id: request.id } });
}

/** The courier's answer, every 15 minutes: settles what Steadfast tells us and flags old items that are late. */
export async function reviewDoorSwaps(now = new Date()) {
  const open = await prisma.returnRequest.findMany({
    where: { swap: true, swapStatus: "AWAITING_SWAP", exchangeOrderId: { not: null } },
    select: { id: true, protectedCod: true, swapNote: true, exchangeOrder: { select: { status: true, courierCodBooked: true, courierCodNow: true, courierCollectedAmount: true } } },
  });
  let settled = 0;
  for (const r of open) {
    const o = r.exchangeOrder;
    if (!o) continue;
    try {
      if (o.status === "CANCELLED" || o.status === "RETURNED") {
        await settleDoorSwap(r.id, "REFUSED", { adminId: null, source: "COURIER" }, "Steadfast returned the new item");
        settled++;
      } else if (o.status === "DELIVERED" || o.status === "PARTIALLY_DELIVERED") {
        const collected = Number(o.courierCollectedAmount ?? o.courierCodNow ?? o.courierCodBooked ?? NaN);
        const protectedCod = Number(r.protectedCod ?? 0);
        if (Number.isFinite(collected) && collected < protectedCod - 0.5) {
          await settleDoorSwap(r.id, "SWAPPED", { adminId: null, source: "COURIER" }, `Delivered, Steadfast collected ${collected}`);
          settled++;
        } else if (!r.swapNote) {
          // Full price collected: kept both — or the rider took the old item and forgot to lower the COD. A person decides.
          await prisma.returnRequest.update({ where: { id: r.id }, data: { swapNote: `Delivered at the full ${protectedCod} — check: kept both, or the rider forgot to lower the COD` } });
        }
      }
    } catch (err) {
      captureError(err, { msg: `[door-swap] review ${r.id}:` });
    }
  }
  const late = await prisma.returnRequest.findMany({
    where: { swap: true, swapStatus: "SWAPPED", swapSettledAt: { lt: new Date(now.getTime() - OLD_ITEM_DAYS * DAY_MS) } },
    select: { id: true },
  });
  for (const r of late) await settleDoorSwap(r.id, "OLD_MISSING", { adminId: null, source: "SWEEP" }).catch((err) => captureError(err, { msg: `[door-swap] late ${r.id}:` }));
  return { settled, late: late.length };
}

/** The receive step: units of an exchanged item scanned in on the original order close their swap as OLD_RECEIVED. */
export async function markOldItemsReceived(orderId: string, receivedLineIds: string[]) {
  if (receivedLineIds.length === 0) return;
  const rows = await prisma.returnRequest.findMany({
    where: { orderId, swap: true, orderItemId: { in: receivedLineIds }, swapStatus: { in: ["SWAPPED", "OLD_MISSING", "AWAITING_SWAP"] } },
    select: { id: true, swapStatus: true },
  });
  for (const r of rows) {
    // Received before Steadfast reported the delivery: the swap evidently happened.
    if (r.swapStatus === "AWAITING_SWAP") await settleDoorSwap(r.id, "SWAPPED", { adminId: null, source: "SCAN" }, "Old item scanned in");
    await settleDoorSwap(r.id, "OLD_RECEIVED", { adminId: null, source: "SCAN" });
  }
}

/** A replacement parcel's code scanned on the receive station after a swap: the old item inside belongs to the ORIGINAL
 * order (its line is what comes back), so the scanner opens that order instead. */
export async function swapRedirect(orderId: string): Promise<{ orderId: string; orderNumber: string } | null> {
  const r = await prisma.returnRequest.findFirst({
    where: { swap: true, exchangeOrderId: orderId, swapStatus: { in: ["SWAPPED", "OLD_MISSING"] } },
    select: { order: { select: { id: true, orderNumber: true } } },
  });
  return r ? { orderId: r.order.id, orderNumber: r.order.orderNumber } : null;
}
