import type { BulkReceiveParcelsInput, BulkReceiveRow } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { courierPaidOutFor } from "../../domain/payments/payment-ledger.service";
import type { AdminIdentity } from "../../domain/auth/authorization";
import { getParcelView, receiveParcel } from "./parcel-receive.service";

type Viewer = Pick<AdminIdentity, "adminId" | "permissions">;

/**
 * Many returned parcels at once (docs/ORDER_OPERATIONS.md "Receive and inspect"): every unit still out comes back in the
 * same condition, the customer kept nothing. Each parcel goes through the same receiveParcel as the scanner (one
 * transaction, one receipt, stock only for what is in hand), so nothing here has rules of its own except which parcels
 * qualify. A parcel is left for a person — never guessed — when:
 *   - there is nothing to receive (already back, delivered, cancelled before shipping),
 *   - the courier collected at least the price of one of its items (the customer may have kept something: which one is
 *     a person's call, on the receive screen).
 * `dryRun` answers the same rows without receiving anything (the preview). Money is never recorded here: a refused
 * parcel's return charge settles from the courier's payout by itself.
 */
export async function bulkReceiveParcels(input: BulkReceiveParcelsInput, viewer: Viewer, batchKey: string): Promise<{ rows: BulkReceiveRow[] }> {
  const rows: BulkReceiveRow[] = [];
  for (const orderId of [...new Set(input.orderIds)]) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { orderNumber: true, courierCollectedAmount: true, deletedAt: true, items: { select: { priceSnapshot: true } } },
    });
    if (!order || order.deletedAt) {
      rows.push({ orderId, orderNumber: order?.orderNumber ?? null, action: "SKIP", units: 0, collected: null, reason: "Order not found" });
      continue;
    }
    const view = await getParcelView(orderId, viewer);
    const base = { orderId, orderNumber: order.orderNumber };
    if (view.receive.mode === "NOTHING") {
      rows.push({ ...base, action: "SKIP", units: 0, collected: null, reason: view.receive.message });
      continue;
    }
    const decides = view.receive.mode === "DECIDE_OUTCOME" || view.receive.mode === "RECONCILE";
    const lines = view.lines
      .map((l) => ({ orderItemId: l.orderItemId, units: decides ? l.ordered - l.received : l.awaiting }))
      .filter((l) => l.units > 0);
    const units = lines.reduce((s, l) => s + l.units, 0);
    if (!units) {
      rows.push({ ...base, action: "SKIP", units: 0, collected: null, reason: "Nothing is still out for this parcel" });
      continue;
    }
    const paidOut = await courierPaidOutFor(prisma, orderId);
    const collectedDec = paidOut ?? order.courierCollectedAmount;
    const collected = collectedDec === null ? null : Number(collectedDec);
    const cheapest = Math.min(...order.items.map((i) => Number(i.priceSnapshot)));
    if (decides && collected !== null && collected > 0 && collected >= cheapest) {
      rows.push({ ...base, action: "SKIP", units, collected, reason: `The courier collected ${collected} — the customer may have kept an item. Receive it on its own.` });
      continue;
    }
    if (input.dryRun) {
      rows.push({ ...base, action: "RECEIVE", units, collected, reason: null });
      continue;
    }
    try {
      await receiveParcel(
        {
          orderId,
          version: view.version,
          outcome: view.receive.mode === "DECIDE_OUTCOME" ? "FULL_RETURN" : undefined,
          note: input.note ?? null,
          lines: lines.map((l) => ({
            orderItemId: l.orderItemId,
            kept: 0,
            good: input.condition === "GOOD" ? l.units : 0,
            damaged: input.condition === "DAMAGED" ? l.units : 0,
            missing: 0,
            wrong: 0,
            other: 0,
          })),
        },
        viewer,
        `${batchKey}:${orderId}`,
      );
      rows.push({ ...base, action: "RECEIVED", units, collected, reason: null });
    } catch (err) {
      rows.push({ ...base, action: "FAILED", units, collected, reason: err instanceof AppError ? err.message : "Could not receive this parcel" });
    }
  }
  return { rows };
}
