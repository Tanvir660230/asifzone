import type { Prisma } from "@prisma/client";
import { releaseSessionReservation } from "../../domain/credit/customer-credit.service";

type Tx = Prisma.TransactionClient;

/**
 * When an order's payable amount changes (a modification applied) or it stops being payable (cancelled), every open way of
 * paying it is closed in the same transaction (docs/ORDER_ADJUSTMENTS.md §11):
 *   - ACTIVE payment links → CANCELLED (a link is tied to the amount and revision it was generated for);
 *   - ACTIVE gateway sessions → EXPIRED, and any store balance they reserved is given back.
 * An expired session can still settle if the customer's gateway tab completes anyway: it then records exactly the amount
 * that session charged (PaymentSession.amount), and any excess surfaces as money owed back — money is never lost and a
 * stale request never pays a different amount than it showed.
 */
export async function closeOpenPaymentRequests(tx: Tx, orderId: string, reason: string, opts: { exceptSessionId?: string; adminId?: string | null } = {}) {
  await tx.paymentLink.updateMany({
    where: { orderId, status: "ACTIVE" },
    data: { status: "CANCELLED", statusReason: reason, cancelledAt: new Date(), cancelledByAdminId: opts.adminId ?? null },
  });
  const sessions = await tx.paymentSession.findMany({
    where: { orderId, status: "ACTIVE", ...(opts.exceptSessionId ? { id: { not: opts.exceptSessionId } } : {}) },
    select: { id: true },
  });
  for (const s of sessions) {
    const claimed = await tx.paymentSession.updateMany({ where: { id: s.id, status: "ACTIVE" }, data: { status: "EXPIRED" } });
    if (claimed.count) {
      await tx.paymentEvent.create({ data: { paymentSessionId: s.id, type: "EXPIRED", note: reason } });
      await releaseSessionReservation(tx, s.id, `Reserved balance returned — ${reason.toLowerCase()}`);
    }
  }
}
