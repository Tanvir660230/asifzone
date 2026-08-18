import crypto from "crypto";
import type { Order, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { sendCustomerOrderSms } from "../../lib/order-sms";
import { sendPaymentConfirmationEmail } from "../../lib/order-mailer";
import { initEpsSession, verifyEpsTransaction } from "./eps.service";
import { initSslcommerzSession } from "./sslcommerz.service";

// Same lookback bound the EPS reconciliation sweep already used before this table existed.
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

// EPS caps merchantTransactionId at 30 characters, so a full UUID (36 chars) doesn't fit — this
// generates a 21-char ref instead (80 bits of randomness, plenty collision-safe given the
// gatewayTransactionRef unique constraint as a backstop).
function newAttemptRef(): string {
  return `p${crypto.randomBytes(10).toString("hex")}`;
}

/** Fire-and-forget timeline write — never blocks or fails the payment flow it's logging, same
 * spirit as lib/audit.ts's recordAudit. */
function recordEvent(paymentSessionId: string, type: string, note?: string, rawResponse?: unknown): void {
  prisma.paymentEvent
    .create({
      data: { paymentSessionId, type, note: note ?? null, rawResponse: rawResponse as Prisma.InputJsonValue | undefined },
    })
    .catch((err) => console.error(`[payment.service] failed to record event ${type} for session ${paymentSessionId}:`, err));
}

/** The single choke point keeping Order.paymentStatus in sync with PaymentSession/Payment reality —
 * every existing consumer (buildOrderWhere, getOrderStats, exportOrdersCsv, bi.service.ts's raw-SQL
 * aggregates, courier's COD check) keeps reading this denormalized column unchanged; none of them
 * need to join through Payment. Never touches a REFUNDED order — refundOrderPayment sets that
 * status directly, and a late settle/fail callback on some other session must not un-refund it. */
async function syncOrderPaymentStatus(orderId: string, outcome: "PAID" | "FAILED") {
  if (outcome === "PAID") {
    return prisma.order.updateMany({
      where: { id: orderId, paymentStatus: { notIn: ["PAID", "REFUNDED"] } },
      data: { paymentStatus: "PAID", status: "CONFIRMED" },
    });
  }
  return prisma.order.updateMany({
    where: { id: orderId, paymentStatus: "UNPAID" },
    data: { paymentStatus: "FAILED" },
  });
}

/** Creates a PaymentSession for this order and starts the gateway's hosted-checkout flow — the
 * caller redirects the customer's browser to the returned gatewayUrl. Used both at checkout
 * (order.controller.ts) and for a later retry on the same order (retryPayment). */
export async function startPaymentSession(order: Order): Promise<{ gatewayUrl: string; sessionId: string }> {
  if (order.paymentMethod === "COD") throw AppError.badRequest("Cash on Delivery orders don't need a payment session");

  const attemptRef = newAttemptRef();
  const session = await prisma.paymentSession.create({
    data: {
      orderId: order.id,
      provider: order.paymentMethod === "EPS_PG" ? "EPS_PG" : "SSLCOMMERZ",
      status: "ACTIVE",
      gatewayTransactionRef: attemptRef,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  const gatewayParams = {
    orderNumber: order.orderNumber,
    attemptRef,
    amount: Number(order.total),
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    customerAddress: order.shippingAddressLine,
  };

  try {
    const { gatewayUrl, providerTransactionId } =
      order.paymentMethod === "EPS_PG"
        ? await initEpsSession(gatewayParams).then((r) => ({ gatewayUrl: r.gatewayUrl, providerTransactionId: r.transactionId }))
        : await initSslcommerzSession(gatewayParams).then((r) => ({ gatewayUrl: r.gatewayUrl, providerTransactionId: r.sessionKey }));

    await prisma.paymentSession.update({ where: { id: session.id }, data: { gatewayUrl, providerTransactionId } });
    recordEvent(session.id, "INITIATED");
    return { gatewayUrl, sessionId: session.id };
  } catch (err) {
    // Init failed at the gateway — this session never produced a usable gatewayUrl, so it's dead on
    // arrival. Marking it FAILED (not leaving it ACTIVE) keeps the one-ACTIVE-session-per-order
    // index from permanently blocking every future attempt on this order.
    await prisma.paymentSession.update({ where: { id: session.id }, data: { status: "FAILED" } }).catch(() => {});
    throw err;
  }
}

/** Replaces markOrderPaid. Looks up the PaymentSession by the gateway's own callback/verify
 * reference (never by orderNumber — an order can now have several attempts). verifiedAmount must
 * come from the gateway's own validation record, never the callback body — the last line of defense
 * against a valid confirmation for one attempt being replayed against a different, more expensive
 * order's attempt. */
export async function settlePaymentSession(
  attemptRef: string,
  providerTransactionId: string,
  verifiedAmount: number,
  rawResponse?: unknown,
): Promise<{ order: Order; justSettled: boolean }> {
  const session = await prisma.paymentSession.findUnique({ where: { gatewayTransactionRef: attemptRef }, include: { order: true } });
  if (!session) throw AppError.notFound("Payment session not found");
  if (session.status !== "ACTIVE") {
    // Already resolved — a racer beat us here, or this is a replayed/late callback. Idempotent no-op.
    return { order: session.order, justSettled: false };
  }
  if (Math.abs(Number(session.order.total) - verifiedAmount) > 0.01) {
    throw AppError.badRequest("Payment amount does not match order total");
  }

  // The WHERE clause here — not the read above — is what actually makes this safe under
  // concurrency: a live redirect callback, the reconciliation cron, and an IPN can all reach this
  // for the same session around the same moment. Only the first UPDATE to actually commit matches
  // `status: "ACTIVE"`; any other racer's updateMany matches zero rows.
  const claimed = await prisma.paymentSession.updateMany({
    where: { gatewayTransactionRef: attemptRef, status: "ACTIVE" },
    data: { status: "SUCCEEDED" },
  });
  if (claimed.count === 0) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: session.orderId } });
    return { order, justSettled: false };
  }

  await prisma.payment.create({
    data: {
      orderId: session.orderId,
      paymentSessionId: session.id,
      provider: session.provider,
      status: "SUCCEEDED",
      amount: session.order.total,
      verifiedAmount,
      providerTransactionId,
      rawResponse: rawResponse as Prisma.InputJsonValue | undefined,
    },
  });
  recordEvent(session.id, "VERIFIED_SUCCESS", undefined, rawResponse);

  // Gated on whether this actually flipped the order (not on `claimed` above) — a second session on
  // the same order somehow also succeeding (a genuine double payment, not a race) still gets its own
  // Payment row recorded for the refund/reconciliation trail, but must not re-send the "confirmed"
  // SMS the customer already received for the first one.
  const syncResult = await syncOrderPaymentStatus(session.orderId, "PAID");
  const order = await prisma.order.findUniqueOrThrow({ where: { id: session.orderId } });
  if (syncResult.count > 0) {
    sendCustomerOrderSms(order, "CONFIRMED");
    sendPaymentConfirmationEmail(order);
  }

  return { order, justSettled: true };
}

/** Replaces markOrderFailed. Same atomic guard shape as settlePaymentSession — only an ACTIVE
 * session can be failed, so a late/duplicate fail callback on an already-resolved session is a
 * no-op rather than corrupting a session another caller already settled. */
export async function markPaymentSessionFailed(attemptRef: string, rawResponse?: unknown): Promise<boolean> {
  const session = await prisma.paymentSession.findUnique({ where: { gatewayTransactionRef: attemptRef }, include: { order: true } });
  if (!session || session.status !== "ACTIVE") return false;

  const claimed = await prisma.paymentSession.updateMany({
    where: { gatewayTransactionRef: attemptRef, status: "ACTIVE" },
    data: { status: "FAILED" },
  });
  if (claimed.count === 0) return false;

  await prisma.payment.create({
    data: {
      orderId: session.orderId,
      paymentSessionId: session.id,
      provider: session.provider,
      status: "FAILED",
      amount: session.order.total,
      rawResponse: rawResponse as Prisma.InputJsonValue | undefined,
    },
  });
  recordEvent(session.id, "VERIFIED_FAILED", undefined, rawResponse);
  await syncOrderPaymentStatus(session.orderId, "FAILED");
  return true;
}

/** Today's cancel handlers (cancel/epsCancel) do nothing but redirect — this gives a bailed-on
 * session a real terminal state so it doesn't sit ACTIVE blocking a retry for its full grace window. */
export async function markPaymentSessionCancelled(attemptRef: string): Promise<boolean> {
  const claimed = await prisma.paymentSession.updateMany({
    where: { gatewayTransactionRef: attemptRef, status: "ACTIVE" },
    data: { status: "CANCELLED" },
  });
  if (claimed.count === 0) return false;

  const session = await prisma.paymentSession.findUnique({ where: { gatewayTransactionRef: attemptRef }, select: { id: true } });
  if (session) recordEvent(session.id, "CANCELLED");
  return true;
}

/** Replaces isOrderPaid's role in epsSuccess's pre-check — looked up by session ref now, since
 * merchantTransactionId identifies an attempt, not an order. Returns the order only if THIS session
 * is the one that settled it, so a re-visited/bookmarked success URL can skip re-verifying with EPS. */
export async function isPaymentSessionSettled(attemptRef: string): Promise<Order | null> {
  const session = await prisma.paymentSession.findUnique({
    where: { gatewayTransactionRef: attemptRef },
    include: { order: true },
  });
  return session?.status === "SUCCEEDED" ? session.order : null;
}

/** Safety net behind the redirect-only EPS callback (see epsSuccess in payment.controller.ts): EPS
 * has no webhook/IPN, only a browser GET redirect, so if the customer's tab closes, crashes, or
 * loses connection before that redirect lands, nothing else would ever tell us the payment
 * succeeded and the session would sit ACTIVE until expireStalePaymentSessions eventually times it
 * out — even though EPS took the money. Re-checks every EPS session that's still ACTIVE a few
 * minutes after checkout and settles it if EPS now confirms success. Deliberately never fails a
 * session here — this only ever sees "not yet confirmed success", not a reliable failure signal, so
 * failing stays the job of the explicit /eps/fail redirect. Bounded to the same 48h window
 * PaymentSession.expiresAt already uses, so an abandoned session doesn't get polled past its own
 * expiry either way. */
export async function reconcileStuckEpsSessions(): Promise<number> {
  const settleGrace = new Date(Date.now() - 3 * 60 * 1000);
  const lookback = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const stuck = await prisma.paymentSession.findMany({
    where: {
      provider: "EPS_PG",
      status: "ACTIVE",
      createdAt: { lte: settleGrace, gte: lookback },
      order: { deletedAt: null },
    },
    // Bounds one job run under a large backlog — the oldest/most-likely-to-have-resolved sessions
    // first, rather than an unbounded scan that could run past the next 5-minute tick.
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { gatewayTransactionRef: true },
  });

  let recovered = 0;
  for (const { gatewayTransactionRef } of stuck) {
    try {
      const validation = await verifyEpsTransaction(gatewayTransactionRef);
      const verified =
        validation && validation.status.toLowerCase() === "success" && validation.merchantTransactionId === gatewayTransactionRef;
      if (verified) {
        await settlePaymentSession(gatewayTransactionRef, validation.epsTransactionId || gatewayTransactionRef, validation.amount, validation);
        recovered++;
      }
    } catch (err) {
      console.error(`[payment-reconciliation-cron] failed to verify session ${gatewayTransactionRef}:`, err);
    }
  }
  return recovered;
}

/** Called from the reconciliation cron. A session that sat ACTIVE past its window with no gateway
 * signal ever arriving (closed tab, crash, lost connection) is marked EXPIRED rather than left
 * ACTIVE forever — otherwise the one-ACTIVE-session-per-order index would permanently block retry. */
export async function expireStalePaymentSessions(): Promise<number> {
  const stale = await prisma.paymentSession.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
    select: { id: true },
    take: 500,
  });
  if (!stale.length) return 0;

  const ids = stale.map((s) => s.id);
  const result = await prisma.paymentSession.updateMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    data: { status: "EXPIRED" },
  });
  for (const id of ids) recordEvent(id, "EXPIRED");
  return result.count;
}

/** Admin-initiated, manual refund — neither EPS nor SSLCommerz expose a refund API (see the comment
 * on the Refund model), so this records what an admin actually did (their own bKash/bank transfer)
 * rather than calling a gateway. Scoped to PAID orders only and moves the order straight to
 * REFUNDED: this system has no PARTIAL_REFUND state, so a smaller-than-total amount is still
 * recorded accurately on the Refund row even though the order-level status is binary. Deliberately
 * bypasses syncOrderPaymentStatus (which explicitly excludes REFUNDED from its own writes) — this is
 * the one place that's allowed to set that status. */
export async function refundOrderPayment(
  orderId: string,
  input: { amount: number; reason?: string; method?: string },
  adminId: string,
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.deletedAt) throw AppError.notFound("Order not found");
  if (order.paymentStatus !== "PAID") throw AppError.badRequest("Only a paid order can be refunded");
  if (input.amount > Number(order.total) + 0.01) {
    throw AppError.badRequest("Refund amount cannot exceed the order total");
  }

  const payment = await prisma.payment.findFirst({
    where: { orderId, status: "SUCCEEDED" },
    orderBy: { settledAt: "desc" },
  });

  const [refund] = await prisma.$transaction([
    prisma.refund.create({
      data: {
        orderId,
        paymentId: payment?.id ?? null,
        amount: input.amount,
        reason: input.reason ?? null,
        method: input.method ?? null,
        status: "COMPLETED",
        requestedByAdminId: adminId,
        completedAt: new Date(),
      },
    }),
    prisma.order.update({ where: { id: orderId }, data: { paymentStatus: "REFUNDED" } }),
  ]);

  if (payment) recordEvent(payment.paymentSessionId, "REFUND_RECORDED", input.reason);

  return refund;
}

export async function listRefundsForOrder(orderId: string) {
  return prisma.refund.findMany({
    where: { orderId },
    include: { requestedByAdmin: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}
