import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { env } from "../../config/env";
import { markOrderFailed, markOrderPaid } from "../orders/order.service";
import { validateSslcommerzTransaction } from "./sslcommerz.service";

/** SSLCommerz posts these fields to success/fail/cancel/ipn; tran_id is the orderNumber we sent when starting the session. */
interface SslCallbackBody {
  tran_id?: string;
  val_id?: string;
  bank_tran_id?: string;
  status?: string;
}

export const success = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as SslCallbackBody;
  const orderNumber = body.tran_id;
  const validation = body.val_id ? await validateSslcommerzTransaction(body.val_id) : null;
  // validation.tranId comes from SSLCommerz's own record for this val_id, not the request body —
  // this is what stops a valid val_id from a small order being replayed against a bigger one.
  const verified = validation && orderNumber && validation.tranId === orderNumber;

  if (!verified || !orderNumber) {
    return res.redirect(`${env.webOrigin}/checkout?paymentError=1`);
  }

  await markOrderPaid(orderNumber, body.bank_tran_id ?? body.val_id ?? "", validation.amount);
  res.redirect(`${env.webOrigin}/order-confirmation/${orderNumber}`);
});

export const fail = asyncHandler(async (req: Request, res: Response) => {
  const orderNumber = (req.body as SslCallbackBody).tran_id;
  if (orderNumber) await markOrderFailed(orderNumber);
  res.redirect(`${env.webOrigin}/checkout?paymentError=1`);
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  res.redirect(`${env.webOrigin}/checkout?paymentCancelled=1`);
});

/** Server-to-server notification — the authoritative confirmation, independent of whether the customer's browser made it back to success_url. */
export const ipn = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as SslCallbackBody;
  const validation = body.val_id ? await validateSslcommerzTransaction(body.val_id) : null;
  if (validation && body.tran_id && validation.tranId === body.tran_id) {
    await markOrderPaid(body.tran_id, body.bank_tran_id ?? body.val_id ?? "", validation.amount);
  }
  res.status(200).send("OK");
});
