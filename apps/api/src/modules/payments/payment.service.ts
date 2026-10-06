import crypto from "crypto";
import type { Order } from "@prisma/client";
import type { OrderItemRow } from "../../config/prisma";
import { Prisma } from "@prisma/client";
import type { CheckoutInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { redis } from "../../config/redis";
import { namespace } from "../../config/installation";
import { AppError } from "../../lib/app-error";
import { notify } from "../../lib/notify";
import { recordOutboxEvents } from "../../domain/outbox/outbox";
import { applyOrderTransition, deriveOrderPricing, insertOrderRecord, type OrderItemSnapshot, type OrderPricingSnapshot } from "../orders/order.service";
import { quoteCart } from "../../domain/pricing/pricing.service";
import { listRefunds, recordFailedAttempt, recordGatewaySettlement, recordRefund } from "../../domain/payments/payment-ledger.service";
import type { MetaRequestContext } from "../../lib/meta/capi";
import { captureError } from "../../lib/observability/error-capture";
import { getProviders } from "../../providers/registry";
import { gatewayIdForPaymentMethod } from "../../providers/capabilities";

/** What's snapshotted onto PaymentSession.checkoutPayload when a storefront digital-payment
 * checkout starts a session with no Order yet (see initiatePendingPayment). `pricing`/
 * `itemSnapshots` are locked in at initiation and used as-is at settlement (settlePaymentSession)
 * rather than recomputed — the customer is charged exactly what they were quoted, immune to any
 * catalog/coupon/flash-sale drift while they're on the gateway page. */
export interface PendingCheckoutPayload {
  input: CheckoutInput;
  customerId: string;
  /** The canonical quote's order-level snapshot (Phase 2 fields optional: payloads from before Phase 2 still settle). */
  pricing: OrderPricingSnapshot;
  itemSnapshots: OrderItemSnapshot[];
  /** The shopper's browser signals for the Meta Purchase event, captured at checkout because the
   * settlement that finally writes the Order may be an IPN/cron with no browser behind it. Absent on
   * sessions started before this existed. */
  metaContext?: MetaRequestContext;
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
    .catch((err) => captureError(err, { msg: `[payment.service] failed to record event ${type} for session ${paymentSessionId}:` }));
}

/** A verified gateway success on an order that already exists (retryPayment / admin-created orders): the Payment row,
 * the paymentStatus projection (payment ledger) and — only for a still-PENDING order — the PENDING → CONFIRMED
 * transition, all in ONE transaction. A late success on a CANCELLED order must not revive it (its stock was already
 * released); it stays cancelled and surfaces in the refund queue instead. */
async function settleExistingOrder(
  orderId: string,
  settlement: {
    paymentSessionId: string;
    provider: "SSLCOMMERZ" | "EPS_PG";
    amount: number;
    verifiedAmount: number;
    providerTransactionId: string;
    rawResponse?: unknown;
  },
): Promise<{ becamePaid: boolean; confirmed: boolean; overpaid: boolean }> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentStatus: true } });
    const { position } = await recordGatewaySettlement(tx, { orderId, ...settlement });
    const becamePaid = before.paymentStatus !== "PAID" && position.status === "PAID";
    const current = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
    if (!becamePaid || current.status !== "PENDING") return { becamePaid, confirmed: false, overpaid: position.overpaid.amount > 0 };
    // The CONFIRMED transition records the customer's "confirmed" SMS intent itself; the receipt email is recorded here —
    // both commit with the settlement (Phase 8).
    await applyOrderTransition(tx, orderId, { status: "CONFIRMED", note: "Payment received" });
    await recordOutboxEvents(tx, [
      { eventType: "payment.settled.v1", consumer: "payment-receipt-email", eventKey: `order:${orderId}:paid`, aggregateType: "Order", aggregateId: orderId, payload: { orderId } },
    ]);
    return { becamePaid, confirmed: true, overpaid: false };
  });
}

/** Creates a PaymentSession for this order and starts the gateway's hosted-checkout flow — the
 * caller redirects the customer's browser to the returned gatewayUrl. Used both at checkout
 * (order.controller.ts) and for a later retry on the same order (retryPayment). */
export async function startPaymentSession(
  order: Order & { items: OrderItemRow[] },
  ipAddress?: string,
): Promise<{ gatewayUrl: string; sessionId: string }> {
  if (order.paymentMethod === "COD") throw AppError.badRequest("Cash on Delivery orders don't need a payment session");
  // Phase 12: the one gateway selection point (registry), before any session row exists.
  const gateway = getProviders().payments.forNewSession(gatewayIdForPaymentMethod(order.paymentMethod));

  const attemptRef = newAttemptRef();
  let session;
  try {
    session = await prisma.paymentSession.create({
      data: {
        orderId: order.id,
        provider: gateway.id,
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
    customerCity: order.shippingDistrict,
    customerState: order.shippingDivision,
    ipAddress,
    items: order.items.map((item) => ({ name: item.productNameSnapshot, quantity: item.quantity, price: Number(item.priceSnapshot) })),
  };

  try {
    const { gatewayUrl, providerTransactionId } = await gateway.createSession(gatewayParams);

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
  ipAddress?: string,
  idempotencyKey?: string | null,
  metaContext?: MetaRequestContext,
): Promise<{ gatewayUrl: string; sessionId: string }> {
  if (input.paymentMethod === "COD") throw AppError.badRequest("Cash on Delivery orders don't need a payment session");

  // Idempotency-Key (the same mechanism as createOrder): a repeat of a started checkout returns its live session.
  if (idempotencyKey) {
    const existing = await prisma.paymentSession.findUnique({ where: { idempotencyKey } });
    if (existing?.status === "ACTIVE" && existing.gatewayUrl) return { gatewayUrl: existing.gatewayUrl, sessionId: existing.id };
    if (existing) throw AppError.conflict("This checkout attempt has already finished — start a new checkout");
  }

  // The canonical quote (validates stock, promotions, shipping, tax; refuses a stale quoteToken) — the gateway is asked
  // for exactly its total, and the lines/snapshot are locked in for settlement.
  const pricing = await deriveOrderPricing(input, customerId);
  const itemSnapshots = pricing.itemSnapshots;
  const { customerId: _c, quote: _q, quoteToken: _t, rows: _r, itemSnapshots: _i, ...snapshot } = pricing;
  void _c; void _q; void _t; void _r; void _i;
  const checkoutPayload: PendingCheckoutPayload = { input, customerId: pricing.customerId, pricing: snapshot, itemSnapshots, metaContext };

  // Phase 12: the one gateway selection point (registry), before the double-submit lock or any session row.
  const gateway = getProviders().payments.forNewSession(gatewayIdForPaymentMethod(input.paymentMethod));

  // Same double-submit guard as createOrder's sessionLockKey (order.service.ts) — a double-click on
  // "Place Order" before the first request's response comes back would otherwise open two live
  // gateway sessions for the same cart. Scoped to still-pre-order (orderId: null) ACTIVE sessions
  // since there's no Order to dedupe against yet.
  const sessionLockKey = input.sessionId ? namespace.lock(`payment-init:${input.sessionId}`) : null;
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
      provider: gateway.id,
      status: "ACTIVE",
      gatewayTransactionRef: attemptRef,
      idempotencyKey: idempotencyKey ?? null,
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
    customerCity: input.shippingDistrict,
    customerState: input.shippingDivision,
    ipAddress,
    items: itemSnapshots.map((item) => ({ name: item.productNameSnapshot, quantity: item.quantity, price: item.priceSnapshot })),
  };

  try {
    const { gatewayUrl, providerTransactionId } = await gateway.createSession(gatewayParams);

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
    // Live catalog rows purely for stock bookkeeping (untracked products, D5) and the low-stock alert — never for
    // pricing: the order is written with the snapshot the customer paid. Best-effort: a variant hard-deleted between
    // checkout and settlement must not cost a customer who already paid their order.
    const rows = await quoteCart({ items: payload!.input.items })
      .then((p) => p.rows)
      .catch((err) => {
        captureError(err, { msg: `[payment.service] failed to fetch live variant info for settlement of session ${session.id}:` });
        return undefined;
      });
    const finalPricing = { customerId: payload!.customerId, rows, ...payload!.pricing };
    // The order and its Payment row are written in ONE transaction (the ledger settlement inside insertOrderRecord), so
    // the order is never PAID without the money record behind it.
    const created = await insertOrderRecord(payload!.input, finalPricing, { status: "CONFIRMED" }, {
      customerSmsTouchpoint: "CONFIRMED",
      allowOversell: true,
      itemSnapshots: payload!.itemSnapshots,
      // Only a storefront checkout ever has a checkoutPayload, so this is always a website purchase.
      metaContext: payload!.metaContext ?? {},
      gatewaySettlement: {
        paymentSessionId: session.id,
        provider: session.provider as "SSLCOMMERZ" | "EPS_PG",
        amount: expectedTotal,
        verifiedAmount,
        providerTransactionId,
        rawResponse,
      },
    });
    orderId = created.id;
    await prisma.paymentSession.update({ where: { id: session.id }, data: { orderId } });
    recordEvent(session.id, "VERIFIED_SUCCESS", undefined, rawResponse);
    return { order: await prisma.order.findUniqueOrThrow({ where: { id: orderId } }), justSettled: true };
  }

  // An existing order: a second session on the same order also succeeding (a genuine double payment, not a race) still
  // gets its own Payment row for the refund trail — it surfaces as an overpayment — but must not re-send the "confirmed"
  // SMS the customer already received for the first one.
  const result = await settleExistingOrder(orderId, {
    paymentSessionId: session.id,
    provider: session.provider as "SSLCOMMERZ" | "EPS_PG",
    amount: expectedTotal,
    verifiedAmount,
    providerTransactionId,
    rawResponse,
  });
  recordEvent(session.id, "VERIFIED_SUCCESS", undefined, rawResponse);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (result.becamePaid && order.status === "CANCELLED") {
    notify({
      type: "order.cancelled_but_paid",
      title: `Cancelled but paid: ${order.orderNumber}`,
      body: `${order.customerName} paid after the order was cancelled — refund may be owed`,
      link: `/admin/orders/${order.id}`,
    });
  } else if (result.overpaid) {
    notify({
      type: "order.overpaid",
      title: `Paid twice: ${order.orderNumber}`,
      body: `${order.customerName} completed a second payment for an already-paid order — refund may be owed`,
      link: `/admin/orders/${order.id}`,
    });
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

  // The FAILED row is recorded and — for an existing order — the payment status re-derived (FAILED only while nothing
  // was ever received: a paid or refunded order keeps its status).
  await prisma.$transaction((tx) =>
    recordFailedAttempt(tx, { orderId: session.orderId, paymentSessionId: session.id, provider: session.provider, amount, rawResponse }),
  );
  recordEvent(session.id, "VERIFIED_FAILED", undefined, rawResponse);
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
      const validation = await getProviders().payments.adapter("EPS_PG").verify(gatewayTransactionRef);
      const verified =
        validation && validation.status.toLowerCase() === "success" && validation.merchantTransactionId === gatewayTransactionRef;
      if (verified) {
        await settlePaymentSession(gatewayTransactionRef, validation.epsTransactionId || gatewayTransactionRef, validation.amount, validation);
        recovered++;
      }
    } catch (err) {
      captureError(err, { msg: `[payment-reconciliation-cron] failed to verify session ${gatewayTransactionRef}:` });
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

/** Admin-initiated, manual refund — neither EPS nor SSLCommerz expose a refund API (see the comment on the Refund model),
 * so this records what an admin actually did (their own bKash/bank transfer). The payment ledger validates it against
 * what was received (partial and repeated refunds allowed, docs/PAYMENT_LEDGER.md §5) and derives the status. Kept as
 * the payments module's entry point (and compatibility export) so the gateway timeline gets its REFUND_RECORDED event. */
export async function refundOrderPayment(
  orderId: string,
  input: { amount: number; reason?: string; method?: string },
  adminId: string,
  idempotencyKey?: string | null,
) {
  const { refund, paymentSessionId, summary } = await recordRefund(orderId, input, adminId, idempotencyKey);
  if (paymentSessionId) recordEvent(paymentSessionId, "REFUND_RECORDED", input.reason);
  return { ...refund, summary };
}

/** Compatibility export (callers move to domain/payments in Phase 5). */
export async function listRefundsForOrder(orderId: string) {
  return listRefunds(orderId);
}
