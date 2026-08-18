import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { env } from "../../config/env";
import { isPaymentSessionSettled, markPaymentSessionCancelled, markPaymentSessionFailed, settlePaymentSession } from "./payment.service";
import { validateSslcommerzTransaction } from "./sslcommerz.service";
import { verifyEpsTransaction } from "./eps.service";

/** SSLCommerz posts these fields to success/fail/cancel/ipn; tran_id is the PaymentSession's
 * gatewayTransactionRef we sent when starting the session (NOT the orderNumber — an order can have
 * several attempts, so tran_id identifies one specific attempt). */
interface SslCallbackBody {
  tran_id?: string;
  val_id?: string;
  bank_tran_id?: string;
  status?: string;
}

/** EPS's own redirect query string is inconsistently cased across their endpoints/environments
 * (observed "MerchantTransactionId" on the success redirect vs. the "merchantTransactionId" our
 * own InitializeEPS call uses) and some of their param names carry stray leading/trailing spaces
 * baked into the key itself (e.g. "EPSTransactionId "). Reading case-/whitespace-insensitively
 * here means we don't silently drop a legitimate callback just because EPS's casing drifts. */
function getEpsQueryParam(req: Request, name: string): string | undefined {
  const target = name.trim().toLowerCase();
  for (const [key, value] of Object.entries(req.query)) {
    if (key.trim().toLowerCase() === target && typeof value === "string") return value.trim();
  }
  return undefined;
}

export const success = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as SslCallbackBody;
  const attemptRef = body.tran_id;
  const validation = body.val_id ? await validateSslcommerzTransaction(body.val_id) : null;
  // validation.tranId comes from SSLCommerz's own record for this val_id, not the request body —
  // this is what stops a valid val_id from one attempt being replayed against a different attempt.
  const verified = validation && attemptRef && validation.tranId === attemptRef;

  if (!verified || !attemptRef) {
    return res.redirect(`${env.webOrigin}/checkout?paymentError=1`);
  }

  const { order } = await settlePaymentSession(attemptRef, body.bank_tran_id ?? body.val_id ?? "", validation.amount, validation);
  res.redirect(`${env.webOrigin}/order-confirmation/${order.orderNumber}`);
});

export const fail = asyncHandler(async (req: Request, res: Response) => {
  const attemptRef = (req.body as SslCallbackBody).tran_id;
  if (attemptRef) await markPaymentSessionFailed(attemptRef);
  res.redirect(`${env.webOrigin}/checkout?paymentError=1`);
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const attemptRef = (req.body as SslCallbackBody).tran_id;
  if (attemptRef) await markPaymentSessionCancelled(attemptRef);
  res.redirect(`${env.webOrigin}/checkout?paymentCancelled=1`);
});

/** Server-to-server notification — the authoritative confirmation, independent of whether the customer's browser made it back to success_url. */
export const ipn = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as SslCallbackBody;
  const validation = body.val_id ? await validateSslcommerzTransaction(body.val_id) : null;
  if (validation && body.tran_id && validation.tranId === body.tran_id) {
    await settlePaymentSession(body.tran_id, body.bank_tran_id ?? body.val_id ?? "", validation.amount, validation);
  }
  res.status(200).send("OK");
});

/** EPS redirects the customer's browser back with a GET, unlike SSLCommerz's POST — see
 * eps.service.ts's initEpsSession, which sets merchantTransactionId to the PaymentSession's
 * gatewayTransactionRef (not the orderNumber). */
export const epsSuccess = asyncHandler(async (req: Request, res: Response) => {
  const attemptRef = getEpsQueryParam(req, "merchantTransactionId");

  // A refreshed tab or a bookmarked/shared success URL hits this same route again after the session
  // is already settled — skip the live EPS round-trip entirely rather than re-verifying something
  // already confirmed.
  if (attemptRef) {
    const settledOrder = await isPaymentSessionSettled(attemptRef);
    if (settledOrder) return res.redirect(`${env.webOrigin}/order-confirmation/${settledOrder.orderNumber}`);
  }

  const validation = attemptRef ? await verifyEpsTransaction(attemptRef) : null;
  const verified = validation && validation.status.toLowerCase() === "success" && validation.merchantTransactionId === attemptRef;

  if (!verified || !attemptRef) {
    return res.redirect(`${env.webOrigin}/checkout?paymentError=1`);
  }

  const { order } = await settlePaymentSession(attemptRef, validation.epsTransactionId || attemptRef, validation.amount, validation);
  res.redirect(`${env.webOrigin}/order-confirmation/${order.orderNumber}`);
});

export const epsFail = asyncHandler(async (req: Request, res: Response) => {
  const attemptRef = getEpsQueryParam(req, "merchantTransactionId");
  if (attemptRef) await markPaymentSessionFailed(attemptRef);
  res.redirect(`${env.webOrigin}/checkout?paymentError=1`);
});

export const epsCancel = asyncHandler(async (req: Request, res: Response) => {
  const attemptRef = getEpsQueryParam(req, "merchantTransactionId");
  if (attemptRef) await markPaymentSessionCancelled(attemptRef);
  res.redirect(`${env.webOrigin}/checkout?paymentCancelled=1`);
});
