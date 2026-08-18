import crypto from "crypto";
import type { Order } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { CheckoutInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { redis } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { sendCustomerOrderSms } from "../../lib/order-sms";
import { sendPaymentConfirmationEmail } from "../../lib/order-mailer";
import { deriveOrderPricing, insertOrderRecord, type DerivedOrderPricing, type OrderItemSnapshot } from "../orders/order.service";
import { resolveCartLines, effectivePrice } from "../orders/cart-lines";
import { initEpsSession, verifyEpsTransaction } from "./eps.service";
import { initSslcommerzSession } from "./sslcommerz.service";

/** What's snapshotted onto PaymentSession.checkoutPayload when a storefront digital-payment
 * checkout starts a session with no Order yet (see initiatePendingPayment). `pricing`/
 * `itemSnapshots` are locked in at initiation and used as-is at settlement (settlePaymentSession)
 * rather than recomputed — the customer is charged exactly what they were quoted, immune to any
 * catalog/coupon/flash-sale drift while they're on the gateway page. */
export interface PendingCheckoutPayload {
  input: CheckoutInput;
  customerId: string;
  pricing: {
    subtotal: number;
    discount: number;
    couponId: string | null;
    couponFreeShipping: boolean;
    bundleId: string | null;
    bundleDiscount: number;
    shippingFee: number;
    total: number;
  };
  itemSnapshots: OrderItemSnapshot[];
}

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
  let session;
  try {
    session = await prisma.paymentSession.create({
      data: {
        orderId: order.id,
        provider: order.paymentMethod === "EPS_PG" ? "EPS_PG" : "SSLCOMMERZ",
        status: "ACTIVE",
        gatewayTransactionRef: attemptRef,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
  } catch (err) {
    // The one-ACTIVE-session-per-order partial unique index rejected this — a concurrent duplicate
    // request for the same order (e.g. a double-click on "Place Order" racing createOrder's own
    // dedup guard, which only covers the Order insert, not this) already has an ACTIVE session in
    // flight. Reuse its gatewayUrl instead of throwing: the caller (order.controller.ts) treats any
    // throw here as "this order can never be paid" and cancels + restocks it, which would rip a real
    // customer's gateway tab out from under them mid-payment.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const active = await prisma.paymentSession.findFirst({ where: { orderId: order.id, status: "ACTIVE" } });
      if (active?.gatewayUrl) return { gatewayUrl: active.gatewayUrl, sessionId: active.id };
    }
    throw err;
  }

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

/** Starts a digital-payment checkout with NO Order yet — the storefront entrypoint for
 * SSLCommerz/EPS checkouts (order.controller.ts's `create`, for every paymentMethod other than
 * COD). Validates the cart/coupon/stock and prices the gateway amount via deriveOrderPricing
 * exactly like createOrder does, but never writes an Order or touches stock: the PaymentSession is
 * created with `orderId: null` and a `checkoutPayload` snapshot of everything needed to materialize
 * the real Order later. That only happens in settlePaymentSession, once the gateway has confirmed
 * success — a failed/cancelled/expired attempt never produces an Order at all, only the existing
 * `Payment` FAILED row (see markPaymentSessionFailed), which is the payment log for it. */
export async function initiatePendingPayment(
  input: CheckoutInput,
  customerId: string | null,
): Promise<{ gatewayUrl: string; sessionId: string }> {
  if (input.paymentMethod === "COD") throw AppError.badRequest("Cash on Delivery orders don't need a payment session");

  const pricing = await deriveOrderPricing(input, customerId);
  const itemSnapshots: OrderItemSnapshot[] = input.items.map((item) => {
    const variant = pricing.variantById.get(item.variantId)!;
    return {
      variantId: item.variantId,
      productNameSnapshot: variant.product.name,
      skuSnapshot: variant.sku,
      sizeSnapshot: variant.size,
      colorSnapshot: variant.color,
      priceSnapshot: effectivePrice(variant, pricing.flashByProduct),
      quantity: item.quantity,
    };
  });
  const checkoutPayload: PendingCheckoutPayload = {
    input,
    customerId: pricing.customerId,
    pricing: {
      subtotal: pricing.subtotal,
      discount: pricing.discount,
      couponId: pricing.couponId,
      couponFreeShipping: pricing.couponFreeShipping,
      bundleId: pricing.bundleId,
      bundleDiscount: pricing.bundleDiscount,
      shippingFee: pricing.shippingFee,
      total: pricing.total,
    },
    itemSnapshots,
  };

  // Same double-submit guard as createOrder's sessionLockKey (order.service.ts) — a double-click on
  // "Place Order" before the first request's response comes back would otherwise open two live
  // gateway sessions for the same cart. Scoped to still-pre-order (orderId: null) ACTIVE sessions
  // since there's no Order to dedupe against yet.
  const sessionLockKey = input.sessionId ? `payment-init-lock:${input.sessionId}` : null;
  const findDuplicateSession = () =>
    prisma.paymentSession.findFirst({
      where: {
        orderId: null,
        status: "ACTIVE",
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
        AND: [
          { checkoutPayload: { path: ["input", "sessionId"], equals: input.sessionId! } },
          { checkoutPayload: { path: ["pricing", "total"], equals: pricing.total } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

  if (sessionLockKey) {
    const acquired = await redis.set(sessionLockKey, "1", "PX", 10_000, "NX").catch(() => "OK");
    if (!acquired) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const existing = await findDuplicateSession();
        if (existing?.gatewayUrl) return { gatewayUrl: existing.gatewayUrl, sessionId: existing.id };
      }
    } else {
      const duplicate = await findDuplicateSession();
      if (duplicate?.gatewayUrl) {
        await redis.del(sessionLockKey).catch(() => {});
        return { gatewayUrl: duplicate.gatewayUrl, sessionId: duplicate.id };
      }
    }
  }

  const attemptRef = newAttemptRef();
  const session = await prisma.paymentSession.create({
    data: {
      orderId: null,
      provider: input.paymentMethod === "EPS_PG" ? "EPS_PG" : "SSLCOMMERZ",
      status: "ACTIVE",
      gatewayTransactionRef: attemptRef,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      checkoutPayload: checkoutPayload as unknown as Prisma.InputJsonValue,
    },
  });

  // No Order (and so no orderNumber) exists yet — the attemptRef is what the gateway actually keys
  // its callback on, so it stands in as the display-only "product name" value too.
  const gatewayParams = {
    orderNumber: attemptRef,
    attemptRef,
    amount: pricing.total,
    customerName: input.customerName,
    customerEmail: input.customerEmail ?? null,
    customerPhone: input.customerPhone,
    customerAddress: input.shippingAddressLine,
  };

  try {
    const { gatewayUrl, providerTransactionId } =
      input.paymentMethod === "EPS_PG"
        ? await initEpsSession(gatewayParams).then((r) => ({ gatewayUrl: r.gatewayUrl, providerTransactionId: r.transactionId }))
        : await initSslcommerzSession(gatewayParams).then((r) => ({ gatewayUrl: r.gatewayUrl, providerTransactionId: r.sessionKey }));

    await prisma.paymentSession.update({ where: { id: session.id }, data: { gatewayUrl, providerTransactionId } });
    recordEvent(session.id, "INITIATED");
    if (sessionLockKey) await redis.del(sessionLockKey).catch(() => {});
    return { gatewayUrl, sessionId: session.id };
  } catch (err) {
    // Init failed at the gateway — nothing was ever reserved (no Order, no stock touched), so
    // there's nothing to compensate beyond marking the dead-on-arrival session FAILED.
    await prisma.paymentSession.update({ where: { id: session.id }, data: { status: "FAILED" } }).catch(() => {});
    if (sessionLockKey) await redis.del(sessionLockKey).catch(() => {});
    throw err;
  }
}

/** Polls for a session's order to show up — used when this call lost a concurrent settle race (a
 * live redirect callback, the reconciliation cron, and an IPN can all reach settlePaymentSession
 * for the same session around the same moment) or found the session already SUCCEEDED from an
 * earlier call. For a pre-order session (orderId was null), the winner of that race is what
 * actually runs insertOrderRecord, so there's a brief real gap between "status flipped to
 * SUCCEEDED" and "the order row exists" — short-poll rather than read a stale/missing order. */
async function waitForSettledOrder(paymentSessionId: string): Promise<Order> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const session = await prisma.paymentSession.findUnique({ where: { id: paymentSessionId }, include: { order: true } });
    if (session?.order) return session.order;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw AppError.conflict("Payment session is still settling — please try again in a moment");
}

/** Replaces markOrderPaid. Looks up the PaymentSession by the gateway's own callback/verify
 * reference (never by orderNumber — an order can now have several attempts). verifiedAmount must
 * come from the gateway's own validation record, never the callback body — the last line of defense
 * against a valid confirmation for one attempt being replayed against a different, more expensive
 * order's attempt.
 *
 * When the session has no Order yet (a storefront digital-payment checkout — see
 * initiatePendingPayment), this is also where that Order gets materialized for the first time,
 * from the checkoutPayload snapshotted at checkout-initiation — never recomputed from live catalog
 * data, so the order's total/items always match exactly what the customer was quoted and charged,
 * regardless of any coupon/flash-sale drift while they were on the gateway page. */
export async function settlePaymentSession(
  attemptRef: string,
  providerTransactionId: string,
  verifiedAmount: number,
  rawResponse?: unknown,
): Promise<{ order: Order; justSettled: boolean }> {
  const session = await prisma.paymentSession.findUnique({ where: { gatewayTransactionRef: attemptRef }, include: { order: true } });
  if (!session) throw AppError.notFound("Payment session not found");

  const payload = session.orderId ? null : (session.checkoutPayload as unknown as PendingCheckoutPayload | null);
  if (!session.orderId && !payload) throw AppError.notFound("Payment session has no order and no checkout data to create one");
  const expectedTotal = session.orderId ? Number(session.order!.total) : payload!.pricing.total;

  // EXPIRED still accepts a settle — it only means the cron or a retry gave up waiting, not that the
  // gateway itself declined. A customer's original gateway tab can complete payment *after* retryPayment
  // (order.service.ts) has already expired this exact session to free up a fresh attempt; without this,
  // that late-but-genuine success would be silently discarded — money taken, order left UNPAID forever.
  // FAILED/CANCELLED/SUCCEEDED are the only true terminal states where a settle is a stale/replayed no-op.
  if (session.status !== "ACTIVE" && session.status !== "EXPIRED") {
    if (session.status === "SUCCEEDED") return { order: await waitForSettledOrder(session.id), justSettled: false };
    if (session.orderId) return { order: session.order!, justSettled: false };
    // A pre-order session that reached FAILED/CANCELLED never created an Order — a success signal
    // arriving after that is a genuine contradiction from the gateway, not a safe stale replay.
    throw AppError.conflict("This payment session already reached a final state");
  }
  if (Math.abs(expectedTotal - verifiedAmount) > 0.01) {
    throw AppError.badRequest("Payment amount does not match order total");
  }

  // The WHERE clause here — not the read above — is what actually makes this safe under
  // concurrency: a live redirect callback, the reconciliation cron, and an IPN can all reach this
  // for the same session around the same moment. Only the first UPDATE to actually commit matches;
  // any other racer's updateMany matches zero rows.
  const claimed = await prisma.paymentSession.updateMany({
    where: { gatewayTransactionRef: attemptRef, status: { in: ["ACTIVE", "EXPIRED"] } },
    data: { status: "SUCCEEDED" },
  });
  if (claimed.count === 0) {
    return { order: await waitForSettledOrder(session.id), justSettled: false };
  }

  let orderId = session.orderId;
  if (!orderId) {
    // Live catalog data purely for informational display (an oversold-item admin alert, the
    // low-stock check) — never for pricing. Best-effort: a variant hard-deleted between checkout
    // and settlement must not cost a customer who already paid their order.
    const liveVariants = await resolveCartLines(payload!.input.items).catch((err) => {
      console.error(`[payment.service] failed to fetch live variant info for settlement of session ${session.id}:`, err);
      return { variantById: new Map(), flashByProduct: new Map() } as Awaited<ReturnType<typeof resolveCartLines>>;
    });
    const finalPricing: DerivedOrderPricing = {
      customerId: payload!.customerId,
      variantById: liveVariants.variantById,
      flashByProduct: liveVariants.flashByProduct,
      ...payload!.pricing,
    };
    const created = await insertOrderRecord(payload!.input, finalPricing, { status: "CONFIRMED", paymentStatus: "PAID" }, {
      customerSmsTouchpoint: "CONFIRMED",
      allowOversell: true,
      itemSnapshots: payload!.itemSnapshots,
    });
    orderId = created.id;
    await prisma.paymentSession.update({ where: { id: session.id }, data: { orderId } });
    sendPaymentConfirmationEmail(created);
  }

  await prisma.payment.create({
    data: {
      orderId,
      paymentSessionId: session.id,
      provider: session.provider,
      status: "SUCCEEDED",
      amount: expectedTotal,
      verifiedAmount,
      providerTransactionId,
      rawResponse: rawResponse as Prisma.InputJsonValue | undefined,
    },
  });
  recordEvent(session.id, "VERIFIED_SUCCESS", undefined, rawResponse);

  // Gated on whether this actually flipped the order (not on `claimed` above) — a second session on
  // the same order somehow also succeeding (a genuine double payment, not a race) still gets its own
  // Payment row recorded for the refund/reconciliation trail, but must not re-send the "confirmed"
  // SMS the customer already received for the first one. A session that just materialized its own
  // order above is already PAID/CONFIRMED and already got its SMS/email from insertOrderRecord, so
  // this is deliberately a no-op for it (syncOrderPaymentStatus's own paymentStatus guard matches 0 rows).
  const syncResult = session.orderId ? await syncOrderPaymentStatus(orderId, "PAID") : { count: 0 };
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (syncResult.count > 0) {
    sendCustomerOrderSms(order, "CONFIRMED");
    sendPaymentConfirmationEmail(order);
  }

  return { order, justSettled: true };
}

/** Replaces markOrderFailed. Same atomic guard shape as settlePaymentSession — only an ACTIVE
 * session can be failed, so a late/duplicate fail callback on an already-resolved session is a
 * no-op rather than corrupting a session another caller already settled.
 *
 * For a pre-order session (orderId null — a storefront digital-payment checkout, see
 * initiatePendingPayment), no Order is ever created here: this Payment FAILED row is itself the
 * "payment log" the failed attempt leaves behind, and there is nothing to sync back onto an Order
 * because none exists. */
export async function markPaymentSessionFailed(attemptRef: string, rawResponse?: unknown): Promise<boolean> {
  const session = await prisma.paymentSession.findUnique({ where: { gatewayTransactionRef: attemptRef }, include: { order: true } });
  if (!session || session.status !== "ACTIVE") return false;

  const claimed = await prisma.paymentSession.updateMany({
    where: { gatewayTransactionRef: attemptRef, status: "ACTIVE" },
    data: { status: "FAILED" },
  });
  if (claimed.count === 0) return false;

  const payload = session.checkoutPayload as unknown as PendingCheckoutPayload | null;
  const amount = session.order ? session.order.total : (payload?.pricing.total ?? 0);

  await prisma.payment.create({
    data: {
      orderId: session.orderId,
      paymentSessionId: session.id,
      provider: session.provider,
      status: "FAILED",
      amount,
      rawResponse: rawResponse as Prisma.InputJsonValue | undefined,
    },
  });
  recordEvent(session.id, "VERIFIED_FAILED", undefined, rawResponse);
  if (session.orderId) await syncOrderPaymentStatus(session.orderId, "FAILED");
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
      // A pre-order session (orderId null — a storefront digital-payment checkout that hasn't
      // settled into an Order yet) has no `order` relation to check `deletedAt` against at all; the
      // plain `order: { deletedAt: null }` shorthand requires a related row to exist, which would
      // silently exclude every one of these from the sweep and break the safety net for exactly the
      // checkouts that need it most. Only actually exclude a session whose *existing* order was
      // soft-deleted.
      OR: [{ orderId: null }, { order: { deletedAt: null } }],
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
