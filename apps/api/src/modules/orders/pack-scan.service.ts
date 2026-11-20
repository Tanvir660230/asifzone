import type { OrderStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import type { PackScanResponse } from "@clothing-brand/shared";
import { resolveOrderCode } from "../parcel-scans/parcel-resolve.service";
import { applyOrderTransition, runTransitionSideEffects } from "./order.service";

/** Statuses a label scan at the packing table moves to PACKED (a pre-shipment move, state machine T1: no stock, payment
 * or customer SMS effect). */
const PACKABLE: OrderStatus[] = ["CONFIRMED", "PROCESSING"];

const SELECT = { id: true, orderNumber: true, customerName: true, status: true, deletedAt: true } as const;

/**
 * Pack scan (Orders audit 2026-11-20): the packer scans the label they just stuck on, and its order becomes Packed. The
 * code is resolved like every other scan (our label barcode, order number, consignment id, Steadfast's codes). Only a
 * confirmed or processing order moves; anything else gets a plain answer and nothing changes. The move goes through the
 * order state machine (row lock, timeline entry), so a second scan — on this device or another — is a no-op.
 */
export async function packByScan(rawCode: string, adminId: string): Promise<PackScanResponse> {
  const found = await resolveOrderCode(rawCode, SELECT);
  if (!found) return { result: "INVALID", message: "No order has this code — check the label" };
  const order = found.order;
  const base = { orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName };

  if (order.deletedAt) return { ...base, result: "INELIGIBLE", message: `${order.orderNumber} is in Trash — don't pack it` };
  if (order.status === "PACKED") return { ...base, result: "ALREADY_PROCESSED", message: `${order.orderNumber} is already packed` };
  if (order.status === "PENDING") return { ...base, result: "INELIGIBLE", message: `${order.orderNumber} isn't confirmed yet — confirm it first` };
  if (!PACKABLE.includes(order.status)) {
    return { ...base, result: "INELIGIBLE", message: `${order.orderNumber} is ${order.status.toLowerCase().replace(/_/g, " ")} — nothing to pack` };
  }

  // Re-checked under the row lock: an order shipped or cancelled since the lookup must not be moved back to Packed
  // (Shipped → Packed is a legal correction, so the state machine alone would allow it).
  const outcome = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ status: OrderStatus }>>`SELECT status FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    if (!locked || !PACKABLE.includes(locked.status)) return null;
    return applyOrderTransition(tx, order.id, { status: "PACKED", note: "Packed — label scanned at the packing table" }, { adminId, quietNoop: true });
  });
  if (!outcome) return { ...base, result: "INELIGIBLE", message: `${order.orderNumber} changed while scanning — open it to check` };
  await runTransitionSideEffects(outcome);
  return { ...base, result: "ACCEPTED", previousStatus: outcome.previousStatus as "CONFIRMED" | "PROCESSING", message: `${order.orderNumber} · ${order.customerName} — packed` };
}
